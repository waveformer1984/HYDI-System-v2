/**
 * Unit tests for scripts/heidi-daily-loop.js — the 15-minute observer loop.
 *
 * The loop's contract: canonical MCP reads, deduped push alerts, one CT-dated
 * brief, and NEVER a recovery action — persistent degradation is escalated to
 * the human because hydi-watchdog owns governed recovery.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const loop = require('../../scripts/heidi-daily-loop');

function ok(data) { return { ok: true, data }; }
function fail(error) { return { ok: false, error }; }

function makeDeps(overrides = {}) {
  const calls = [];
  const notifications = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-state-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const deps = {
    calls,
    notifications,
    stateFile,
    state: loop.defaultState(),
    supabase: {},
    callTool: jest.fn(async (name) => {
      calls.push(name);
      if (name === 'system_health') return ok({ all_up: true, checks: [] });
      if (name === 'pending_approvals') return ok({ count: 0, actions: [] });
      if (name === 'mobile_status') return ok({ streams: [] });
      return fail(`unknown tool ${name}`);
    }),
    notify: jest.fn(async (_sb, n) => { notifications.push(n); return n; }),
    ct: { dateCt: '2026-10-10', hour: 3, minute: 0 },
    ...overrides,
  };
  return deps;
}

describe('centralNow', () => {
  it('converts to America/Chicago correctly across a DST-aware date', () => {
    // 2026-10-10T14:00Z is 09:00 CT (CDT, UTC-5 in October)
    const ct = loop.centralNow(new Date('2026-10-10T14:00:00Z'));
    expect(ct).toEqual({ dateCt: '2026-10-10', hour: 9, minute: 0 });
  });
});

describe('shouldSendBrief', () => {
  it('fires inside the 8:00 CT window when not yet sent today', () => {
    const s = loop.defaultState();
    expect(loop.shouldSendBrief(s, { dateCt: '2026-10-10', hour: 8, minute: 7 })).toBe(true);
  });
  it('does not fire twice on the same CT date', () => {
    const s = { ...loop.defaultState(), lastBriefDateCt: '2026-10-10' };
    expect(loop.shouldSendBrief(s, { dateCt: '2026-10-10', hour: 8, minute: 5 })).toBe(false);
  });
  it('does not fire outside the window', () => {
    const s = loop.defaultState();
    expect(loop.shouldSendBrief(s, { dateCt: '2026-10-10', hour: 8, minute: 30 })).toBe(false);
    expect(loop.shouldSendBrief(s, { dateCt: '2026-10-10', hour: 7, minute: 59 })).toBe(false);
    expect(loop.shouldSendBrief(s, { dateCt: '2026-10-10', hour: 9, minute: 0 })).toBe(false);
  });
});

describe('newApprovalIds', () => {
  it('returns only ids not already alerted', () => {
    const pending = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(loop.newApprovalIds(pending, ['b'])).toEqual(['a', 'c']);
    expect(loop.newApprovalIds(pending, ['a', 'b', 'c'])).toEqual([]);
  });
  it('tolerates malformed rows', () => {
    expect(loop.newApprovalIds([null, {}, { id: 'x' }], [])).toEqual(['x']);
  });
});

describe('tick', () => {
  it('a healthy quiet tick pushes nothing', async () => {
    const d = makeDeps();
    const s = await loop.tick(d);
    expect(s.health).toBe('all_up');
    expect(s.alerts).toEqual([]);
    expect(d.notifications).toEqual([]);
  });

  it('alerts only on NEW pending approvals and never re-alerts resolved or seen ids', async () => {
    const actions = [{ id: 'a1', action_type: 'send_email' }];
    const d = makeDeps({
      callTool: jest.fn(async (name) => {
        if (name === 'pending_approvals') return ok({ count: 1, actions });
        if (name === 'system_health') return ok({ all_up: true, checks: [] });
        return ok({});
      }),
    });
    const s1 = await loop.tick(d);
    expect(s1.alerts).toEqual(['approvals']);
    expect(d.notifications).toHaveLength(1);
    expect(d.notifications[0].category).toBe('approval_required');

    // Second tick, same action still pending — no re-alert.
    const s2 = await loop.tick({ ...d, state: d.state });
    expect(s2.alerts).toEqual([]);
    expect(d.notifications).toHaveLength(1);
  });

  it('re-alerts an id that resolved and came back', async () => {
    let pending = [{ id: 'a1' }];
    const d = makeDeps({
      callTool: jest.fn(async (name) => {
        if (name === 'pending_approvals') return ok({ count: pending.length, actions: pending });
        return ok({ all_up: true, checks: [] });
      }),
    });
    await loop.tick(d);
    pending = []; // resolved
    await loop.tick({ ...d, state: d.state });
    pending = [{ id: 'a1' }]; // escalated again
    const s3 = await loop.tick({ ...d, state: d.state });
    expect(s3.alerts).toEqual(['approvals']);
  });

  it('a single degraded tick logs but does not escalate (watchdog owns recovery)', async () => {
    const d = makeDeps({
      callTool: jest.fn(async (name) => {
        if (name === 'system_health') return ok({ all_up: false, checks: [{ service: 'protoforge-core', up: false }] });
        if (name === 'pending_approvals') return ok({ count: 0, actions: [] });
        return ok({});
      }),
    });
    const s = await loop.tick(d);
    expect(s.health).toBe('degraded');
    expect(s.alerts).toEqual([]);
    expect(d.notifications).toEqual([]);
    expect(d.state.degradedTicks).toBe(1);
  });

  it('escalates once after consecutive degraded ticks, then dedupes until recovery', async () => {
    const d = makeDeps({
      callTool: jest.fn(async (name) => {
        if (name === 'system_health') return ok({ all_up: false, checks: [{ service: 'heidi-web', up: false }] });
        if (name === 'pending_approvals') return ok({ count: 0, actions: [] });
        return ok({});
      }),
    });
    await loop.tick(d);                                  // tick 1
    const s2 = await loop.tick({ ...d, state: d.state }); // tick 2 — escalate
    expect(s2.alerts).toEqual(['outage']);
    expect(d.notifications).toHaveLength(1);
    expect(d.notifications[0].category).toBe('worker_failure');
    const s3 = await loop.tick({ ...d, state: d.state }); // tick 3 — deduped
    expect(s3.alerts).toEqual([]);
    expect(d.notifications).toHaveLength(1);
  });

  it('clears the outage alert state on recovery so a new outage re-alerts', async () => {
    let up = false;
    const d = makeDeps({
      callTool: jest.fn(async (name) => {
        if (name === 'system_health') return ok({ all_up: up, checks: [] });
        if (name === 'pending_approvals') return ok({ count: 0, actions: [] });
        return ok({});
      }),
    });
    await loop.tick(d);
    await loop.tick({ ...d, state: d.state });           // escalated
    up = true;
    await loop.tick({ ...d, state: d.state });           // recovered
    expect(d.state.outageAlerted).toBe(false);
    up = false;
    await loop.tick({ ...d, state: d.state });
    const s = await loop.tick({ ...d, state: d.state }); // new outage — re-alerts
    expect(s.alerts).toEqual(['outage']);
  });

  it('an MCP read failure is logged, not escalated as a service outage', async () => {
    const d = makeDeps({
      callTool: jest.fn(async (name) => {
        if (name === 'system_health') return fail('ECONNREFUSED');
        if (name === 'pending_approvals') return ok({ count: 0, actions: [] });
        return ok({});
      }),
    });
    const s = await loop.tick(d);
    expect(s.health).toBe('read_failed');
    expect(s.alerts).toEqual([]);
    expect(d.notifications).toEqual([]);
  });

  it('sends the morning brief once per CT date with health, streams and approvals', async () => {
    const d = makeDeps({
      ct: { dateCt: '2026-10-10', hour: 8, minute: 3 },
      callTool: jest.fn(async (name) => {
        if (name === 'system_health') return ok({ all_up: true, checks: [] });
        if (name === 'pending_approvals') return ok({ count: 2, actions: [{ id: 'a' }, { id: 'b' }] });
        if (name === 'mobile_status') return ok({ streams: [{ stream: 'rezonate', revenue_cents: 5000 }] });
        return ok({});
      }),
    });
    const s = await loop.tick(d);
    expect(s.brief).toBe('sent');
    const brief = d.notifications.find((n) => n.category === 'document_generated');
    expect(brief.title).toBe('Heidi morning brief');
    expect(brief.body).toContain('all core services up');
    expect(brief.body).toContain('rezonate $50.00');
    expect(brief.body).toContain('2 waiting');
    expect(d.state.lastBriefDateCt).toBe('2026-10-10');
  });

  it('marks the brief sent even when notification delivery fails — no duplicate briefs', async () => {
    const d = makeDeps({
      ct: { dateCt: '2026-10-10', hour: 8, minute: 3 },
      notify: jest.fn(async () => { throw new Error('supabase down'); }),
    });
    const s = await loop.tick(d);
    expect(s.brief).toBe('notify_failed');
    expect(d.state.lastBriefDateCt).toBe('2026-10-10');
  });
});
