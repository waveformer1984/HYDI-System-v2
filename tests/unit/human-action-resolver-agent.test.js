'use strict';

/**
 * Human Action Resolution Agent — governed deployment tests.
 *
 * Proves the sweep runs as a real Agent Control Plane mission when a
 * pool exists (deterministic missionId dedupe, budget enforcement,
 * durable status), and identical governed behavior inline without one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let dir, storeFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-agent-'));
  storeFile = path.join(dir, 'human-actions.json');
  process.env.HYDI_HUMAN_ACTIONS_FILE = storeFile;
});

afterEach(() => {
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
  delete process.env.HYDI_MAX_ACTIVE_AGENTS;
});

const { HumanActionService } = require('../../lib/human-actions/service');
const { runHumanActionResolverAgent, RESOLVER_AGENT_ID } = require('../../lib/human-actions/resolver-agent');
const { resolveEligibleActions, syncHumanActions } = require('../../lib/human-actions/detector');
const { tryHumanActionAnswer } = require('../../lib/human-actions/heidi-answer');
const { inventoryBlockers, formatInventoryBrief } = require('../../lib/human-actions/inventory');

const mkEnv = (vals = {}) => ({
  envNamePresent: (n) => vals[n] !== undefined && vals[n] !== '',
  envValue: (n) => vals[n] ?? null,
});

/**
 * Minimal in-memory pg stand-in — implements exactly the query shapes
 * AgentControlPlane uses: INSERT ... RETURNING id, the agent_mission
 * lookup, the division fold, and the mission-status claim read. No
 * connect() → runAgent uses its non-transactional claim path.
 */
function makePool() {
  const events = [];
  let seq = 0;
  const push = (event_type, payloadJson, verdict = 'RECORDED') => {
    seq++;
    const row = { id: String(seq), event_type, division: 'agents', payload: JSON.parse(payloadJson), verdict, created_at: new Date(1700000000000 + seq * 1000).toISOString() };
    events.push(row);
    return { rows: [{ id: String(seq) }] };
  };
  const lastStatus = (missionId) => {
    const rows = events.filter((e) => e.event_type === 'agent_status' && e.payload.missionId === missionId);
    const last = rows[rows.length - 1];
    return { rows: last ? [{ s: last.payload.status }] : [] };
  };
  const query = async (sql, params = []) => {
    if (/INSERT INTO heidi_events/.test(sql)) {
      // claim path writes status with literal columns and $1=payload
      if (/VALUES \('agent_status','agents',\$1/.test(sql)) return push('agent_status', params[0]);
      return push(params[0], params[1], params[2]);
    }
    if (/event_type = 'agent_mission' AND payload->>'missionId' = \$1/.test(sql)) {
      return { rows: events.filter((e) => e.event_type === 'agent_mission' && e.payload.missionId === params[0]).map((e) => ({ payload: e.payload })) };
    }
    if (/payload->>'status' s FROM heidi_events/.test(sql) || (/event_type ?= ?'agent_status'/.test(sql) && /missionId/.test(sql))) {
      return lastStatus(params[0]);
    }
    if (/FROM heidi_events/.test(sql) && /division = 'agents'/.test(sql)) {
      return { rows: events.map((e) => ({ event_type: e.event_type, payload: e.payload, created_at: e.created_at })) };
    }
    return { rows: [] };
  };
  // connect() → the real transactional claim path: BEGIN / advisory lock /
  // status read / INSERT RUNNING / COMMIT. Single-threaded in-memory —
  // the advisory lock is a no-op, but the terminal-status check is real.
  const connect = async () => ({
    query: async (sql, params = []) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      return query(sql, params);
    },
    release: () => { },
  });
  return { events, query, connect };
}

const fakePlane = { canAutoModify: () => true, set: () => ({ success: true, verified: true }) };

describe('resolver agent — governed deployment', () => {
  test('pool present → sweep runs inside a resolver mission (durable agent record)', async () => {
    const svc = new HumanActionService();
    const pool = makePool();
    const out = await runHumanActionResolverAgent({
      service: svc, pool, env: mkEnv(), resolverDeps: { configPlane: fakePlane },
    });
    expect(out.agent).toBe(RESOLVER_AGENT_ID);
    expect(out.via).toBe('mission');
    expect(out.missionId).toMatch(/^mission-/);
    // durable events: mission + agent_registered + RUNNING + COMPLETED
    const types = pool.events.map((e) => e.event_type);
    expect(types).toContain('agent_mission');
    expect(types).toContain('agent_registered');
    const mission = pool.events.find((e) => e.event_type === 'agent_mission');
    expect(mission.payload.role).toBe('resolver');
    expect(mission.payload.params.agent).toBe(RESOLVER_AGENT_ID);
    // the sweep summary is THIS mission's durable result
    const completed = pool.events.find(
      (e) => e.event_type === 'agent_status' && e.payload.status === 'COMPLETED' && e.payload.missionId === out.missionId,
    );
    expect(completed).toBeTruthy();
    expect(completed.payload.result).toHaveProperty('resolve');
  });

  test('mission dedupe: same hour → one coordinator mission, cadence still runs', async () => {
    const svc = new HumanActionService();
    const pool = makePool();
    const opts = { service: svc, pool, env: mkEnv(), resolverDeps: { configPlane: fakePlane } };
    const first = await runHumanActionResolverAgent(opts);
    const second = await runHumanActionResolverAgent(opts);
    expect(second.missionId).toBe(first.missionId);
    expect(second.via).toBe('mission+inline'); // hour's mission terminal → cadence ran inline
    expect(second.sync).toBeTruthy();
    expect(pool.events.filter((e) => e.event_type === 'agent_mission' && e.payload.params?.coordinated).length).toBe(1);
  });

  test('agent budget respected: at capacity → sweep runs inline, no new mission', async () => {
    process.env.HYDI_MAX_ACTIVE_AGENTS = '1';
    const svc = new HumanActionService();
    const pool = makePool();
    // Seed a RUNNING agent directly — a fresh heartbeat keeps it 'active'
    // under the supervisor's stale/fail classification, so the budget is full.
    const t = new Date().toISOString();
    pool.events.push(
      { id: 'r1', event_type: 'agent_registered', division: 'agents', payload: { agentId: 'agent-busy', name: 'busy', role: 'research', missionId: 'mission-busy', authorizationLevel: 'R1', status: 'RUNNING' }, verdict: 'RECORDED', created_at: t },
      { id: 'r2', event_type: 'agent_status', division: 'agents', payload: { agentId: 'agent-busy', missionId: 'mission-busy', status: 'RUNNING' }, verdict: 'RECORDED', created_at: t },
      { id: 'r3', event_type: 'agent_heartbeat', division: 'agents', payload: { agentId: 'agent-busy', missionId: 'mission-busy', step: 'working' }, verdict: 'RECORDED', created_at: t },
    );
    const out = await runHumanActionResolverAgent({
      service: svc, pool, env: mkEnv(), resolverDeps: { configPlane: fakePlane },
    });
    expect(out.via).toBe('inline');
    expect(out.atCapacity).toBe(true);
    expect(out.sync).toBeTruthy();
    // no coordinator mission minted while the budget is full
    expect(pool.events.filter((e) => e.event_type === 'agent_mission' && e.payload.role === 'resolver').length).toBe(0);
  });

  test('no pool → identical governed sweep inline, agent identity reported', async () => {
    const svc = new HumanActionService();
    const out = await runHumanActionResolverAgent({
      service: svc, env: mkEnv(), resolverDeps: { configPlane: fakePlane },
    });
    expect(out.via).toBe('inline');
    expect(out.agent).toBe(RESOLVER_AGENT_ID);
    expect(out.sync.detection.checked).toBeGreaterThan(0);
    expect(out.summary.resolve).toBeTruthy();
  });
});

describe('resolver mission deployment per action (pool path)', () => {
  test('R0 resolver deploys as a deterministic resolver mission; repeat pass dedupes', async () => {
    const svc = new HumanActionService();
    const pool = makePool();
    const a = svc.request({
      blockerKey: 'stripe:webhook-processing', type: 'config', title: 't',
      boundary: { category: 'EXTERNAL_SERVICE' },
      verifier: { name: 'env-vars', spec: { envNames: ['__RESOLVER_TEST_NEVER_SET__'] } },
    }).action;
    const fakePlane = { canAutoModify: () => true, set: () => ({ success: true, verified: true }) };
    const first = await resolveEligibleActions(svc, { env: mkEnv(), throttleMs: 0, pool, deps: { configPlane: fakePlane } });
    expect(first.attempted[0].outcome).toBe('completed');
    const missions = pool.events.filter((e) => e.event_type === 'agent_mission');
    expect(missions.length).toBe(1);
    expect(missions[0].payload.role).toBe('resolver');
    expect(missions[0].payload.params.blockerKey).toBe('stripe:webhook-processing');
    expect(missions[0].payload.params.capability).toBe('config.write');
    // attempt record carries the mission id — agent↔action linkage durable
    const got = svc.get(a.id);
    expect(got.resolver.attempts[0].missionId).toBe(missions[0].payload.missionId);
    // second pass (throttle cleared) → mission dedupe → deferred, no re-execution
    const second = await resolveEligibleActions(svc, { env: mkEnv(), throttleMs: 0, pool, deps: { configPlane: fakePlane } });
    expect(second.deferred.some((d) => d.reason === 'resolver mission already completed for this action')).toBe(true);
    expect(pool.events.filter((e) => e.event_type === 'agent_mission').length).toBe(1);
  });
});

describe('priority ordering', () => {
  test('revenue/production boundaries resolve before generic ones', async () => {
    const svc = new HumanActionService();
    const order = [];
    const fakePlane = {
      canAutoModify: () => true,
      set: (k) => { order.push(k); return { success: true, verified: true }; },
    };
    // Two R0 actions — but only stripe:webhook-processing has a registry entry.
    // Priority ordering is exercised via the sweep's iteration: create a
    // revenue blocker + a generic one; revenue must classify first.
    svc.request({
      blockerKey: 'other:generic', type: 'config', title: 'generic',
      priority: 'low', boundary: { category: 'OTHER' },
      verifier: { name: 'manual', spec: {} },
    });
    svc.request({
      blockerKey: 'stripe:live-credential', type: 'credential', title: 'live cred',
      priority: 'high', boundary: { category: 'CREDENTIAL', externalSystem: 'stripe' },
      verifier: { name: 'manual', spec: {} },
    });
    const out = await resolveEligibleActions(svc, { env: mkEnv(), throttleMs: 0, deps: { configPlane: fakePlane } });
    // both R2 (human) — but the order they appear proves deterministic sort:
    const idx = out.human.map((h) => svc.get(h.actionId).blockerKey);
    expect(idx.indexOf('stripe:live-credential')).toBeLessThan(idx.indexOf('other:generic'));
  });
});

describe('inventory — the "no silent abandonment" audit', () => {
  test('every open action has exactly one disposition; unclassified = 0', async () => {
    const svc = new HumanActionService();
    await syncHumanActions(svc, null, { env: mkEnv(), resolve: { throttleMs: 0 } });
    const inv = inventoryBlockers({ service: svc, env: mkEnv() });
    expect(inv.actions.dispositions.UNCLASSIFIED).toBe(0);
    expect(inv.actions.duplicatesPrevented).toBe(true);
    expect(inv.actions.open).toBe(inv.openItems.length);
    const total = Object.values(inv.actions.dispositions).reduce((s, n) => s + n, 0);
    expect(total).toBe(inv.actions.open);
    const brief = formatInventoryBrief(inv);
    expect(brief).toContain('Human Actions');
    expect(brief).toContain('Dedupe: clean');
  });

  test('ASK chat reports the resolution breakdown — armed vs human-only', async () => {
    const svc = new HumanActionService();
    await syncHumanActions(svc, null, { env: mkEnv(), resolve: { throttleMs: 0 } });
    const ans = await tryHumanActionAnswer('what do you need from me', { service: svc });
    expect(ans.text).toMatch(/autonomous-resolver armed|awaiting human/);
    expect(ans.text).toContain('resolution:');
  });

  test('ASK chat never runs a mutation-capable resolver (read-path)', async () => {
    const svc = new HumanActionService();
    svc.request({
      blockerKey: 'stripe:webhook-processing', type: 'config', title: 't',
      boundary: { category: 'EXTERNAL_SERVICE' },
      verifier: { name: 'env-vars', spec: { envNames: ['__RESOLVER_TEST_NEVER_SET__'] } },
    });
    const setCalls = [];
    await tryHumanActionAnswer('what is blocking revenue', {
      service: svc,
      resolverDeps: { configPlane: { canAutoModify: () => true, set: (...a) => setCalls.push(a) } },
    });
    expect(setCalls.length).toBe(0);
  });
});
