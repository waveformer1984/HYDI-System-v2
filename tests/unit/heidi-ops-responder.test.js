'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  createOpsResponder, parseRequest, triage, outcomeText, CLARIFY, REPLY_LIMIT,
  REFUSAL, SECRET_ALERT, ASSESSMENT_COOLDOWN_MS, allowedSenders,
} = require('../../lib/heidi/ops-responder');
const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { TaskStore } = require('../../lib/execution-fabric/task-store');

const T0 = Date.parse('2026-10-21T18:00:00.000Z');

function tmpState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-responder-'));
  return path.join(dir, 'state.json');
}

function req(id, text, minutesAgo = 1, sender = 'hydi-daemon', senderType = 'agent') {
  return {
    id, channel: 'ops', sender, sender_type: senderType, reply_to: null,
    ts: new Date(T0 - minutesAgo * 60000).toISOString(), body: `REQUEST @Heidi: ${text}`,
  };
}

function harness(overrides = {}) {
  const posts = [];
  const execCalls = [];
  let clock = overrides.start || T0;
  const deps = {
    stateFile: overrides.stateFile || tmpState(),
    now: () => clock,
    board: { post: jest.fn(async (channel, body, replyTo) => { posts.push({ channel, body, replyTo }); return { ok: true }; }) },
    execFile: (file, args, opts, cb) => {
      execCalls.push([file, ...args]);
      if (file === 'pm2' || file === 'cmd.exe') return cb(null, JSON.stringify([{ name: 'heidi-web', pm2_env: { status: 'online', restart_time: 2, pm_uptime: clock - 3 * 3600000 } }]), '');
      if (file === 'git' && args[0] === 'status') return cb(null, '## clean-main...origin/clean-main\n', '');
      if (file === 'git' && args[0] === 'log') return cb(null, 'abc1234 Merge pull request #386\n', '');
      if (String(args[0] || '').endsWith('heidi-assessment-crew.js')) return cb(null, `thread root: crew-${execCalls.length}\nAnna: 2 findings, 1 recs\n`, '');
      return cb(new Error('unexpected command'), '', '');
    },
    platform: 'linux',
    statfs: async () => ({ blocks: 1000, bsize: 1024 ** 2, bavail: 250 }),
    runHealthCheck: async () => ({ ok: true, probes: [{ name: 'heidi-web', ok: true, ms: 12, hint: 'ok' }] }),
    billingStore: () => ({ findMany: async () => [] }),
    serviceSecret: () => 'test-secret',
    warn: jest.fn(),
    fabric: overrides.fabric || {
      file: jest.fn(async () => ({ ok: true, task: { id: 'a'.repeat(24), state: 'AWAITING_APPROVAL' } })),
      get: jest.fn(async (id) => ({ ok: true, task: { id, state: 'AWAITING_APPROVAL' }, detail: {} })),
    },
    ...overrides.deps,
  };
  const responder = createOpsResponder(deps);
  return { responder, posts, execCalls, deps, advance: (ms) => { clock += ms; } };
}

describe('parseRequest / triage', () => {
  it('only takes top-level #ops REQUEST @Heidi posts from others', () => {
    expect(parseRequest(req('1', 'fleet status'))).toMatchObject({ id: '1', text: 'fleet status' });
    expect(parseRequest({ ...req('2', 'x'), channel: 'general' })).toBeNull();
    expect(parseRequest({ ...req('3', 'x'), sender: 'Heidi' })).toBeNull();
    expect(parseRequest({ ...req('4', 'x'), reply_to: '1' })).toBeNull();
    expect(parseRequest({ ...req('5', 'x'), body: 'hello @Heidi' })).toBeNull();
  });

  it('routes only allow-listed reads; anything that changes state needs approval', () => {
    expect(triage('fleet status')).toEqual({ kind: 'read', tool: 'fleet' });
    expect(triage('pm2 list please')).toEqual({ kind: 'read', tool: 'fleet' });
    expect(triage('check health')).toEqual({ kind: 'read', tool: 'health' });
    expect(triage('how much disk space is left')).toEqual({ kind: 'read', tool: 'disk' });
    expect(triage('git status')).toEqual({ kind: 'read', tool: 'git' });
    expect(triage('show git log')).toEqual({ kind: 'read', tool: 'git' });
    expect(triage('run the assessment crew')).toEqual({ kind: 'read', tool: 'assessment' });
    expect(triage('revenue summary')).toEqual({ kind: 'read', tool: 'revenue' });
    for (const ask of ['restart heidi-web', 'deploy clean-main', 'scale up workers', 'spend $50 on ads',
      'email the customer', 'fix the bug in api/chat', 'check health then restart pm2', 'refund the revenue', 'grow outreach']) {
      expect(triage(ask)).toEqual({ kind: 'approval' });
    }
    expect(triage('look into it')).toEqual({ kind: 'unclear' });
  });
});

describe('ops responder', () => {
  it('answers a read with real output and timestamps, and never puts board text in argv', async () => {
    const h = harness();
    expect(triage('fleet status; pm2 kill')).toEqual({ kind: 'approval' });
    await h.responder.tick([req('r1', 'fleet status; rm -rf / && cat ~/.ssh/id_rsa')]);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({ channel: 'ops', replyTo: 'r1' });
    expect(h.posts[0].body).toContain('PM2: 1/1 online');
    expect(h.posts[0].body).toContain('heidi-web: online (restarts 2, up 3h)');
    expect(h.posts[0].body).toContain(`Started ${new Date(T0).toISOString()}, finished ${new Date(T0).toISOString()}`);
    expect(h.execCalls).toEqual([['pm2', 'jlist']]);
    expect(h.deps.fabric.file).not.toHaveBeenCalled();
  });

  it('uses cmd /c pm2 jlist on Windows', async () => {
    const h = harness({ deps: { platform: 'win32' } });
    await h.responder.tick([req('w1', 'pm2 status')]);
    expect(h.execCalls).toEqual([['cmd.exe', '/c', 'pm2', 'jlist']]);
  });

  it('git, disk and health use fixed commands', async () => {
    const h = harness();
    await h.responder.tick([req('g', 'git status'), req('d', 'disk space'), req('hc', 'health')]);
    expect(h.execCalls).toEqual([['git', 'status', '--short', '--branch'], ['git', 'log', '--oneline', '-5']]);
    expect(h.posts.map((p) => p.replyTo)).toEqual(['g', 'd', 'hc']);
    expect(h.posts[1].body).toContain('0.2 GB free of 1.0 GB (25% free)');
    expect(h.posts[2].body).toContain('heidi-web: up, ok (12ms)');
  });

  it('handles each request once, including across a restart', async () => {
    const stateFile = tmpState();
    const a = harness({ stateFile });
    const msgs = [req('d1', 'disk')];
    await a.responder.tick(msgs);
    await a.responder.tick(msgs);
    expect(a.posts).toHaveLength(1);
    const b = harness({ stateFile });
    await b.responder.tick(msgs);
    expect(b.posts).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).handled.d1).toMatchObject({ kind: 'read', tool: 'disk' });
  });

  it('first boot skips stale requests and ones Heidi already answered', async () => {
    const h = harness();
    const answered = req('old2', 'disk', 10);
    await h.responder.tick([
      req('old1', 'disk', 7 * 60),
      answered,
      { id: 'x', channel: 'ops', sender: 'Heidi', reply_to: 'old2', body: 'Noted.' },
      req('new1', 'disk', 2),
    ]);
    expect(h.posts.map((p) => p.replyTo)).toEqual(['new1']);
  });

  it('asks one clarifying question when unclear', async () => {
    const h = harness();
    await h.responder.tick([req('u1', 'look into it')]);
    expect(h.posts).toEqual([{ channel: 'ops', body: CLARIFY, replyTo: 'u1' }]);
    expect(CLARIFY.match(/\?/g)).toHaveLength(1);
  });

  it('files an approval for anything else, does not run it, and says waiting for Jordan', async () => {
    const h = harness();
    await h.responder.tick([req('a1', 'restart heidi-web')]);
    expect(h.deps.fabric.file).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', text: 'restart heidi-web' }));
    expect(h.execCalls).toEqual([]);
    expect(h.posts[0].body).toBe(`Approval filed: ${'a'.repeat(24)} (execution-fabric, needs fabric:control). Not run — waiting for Jordan.`);
    expect(h.responder.state().handled.a1).toMatchObject({ kind: 'approval', task_id: 'a'.repeat(24), outcome_posted: false });
  });

  it('says so when the approval cannot be filed', async () => {
    const h = harness({ fabric: { file: async () => ({ ok: false, error: 'HYDI_SERVICE_SECRET is not set on this host' }), get: jest.fn() } });
    await h.responder.tick([req('a2', 'deploy')]);
    expect(h.posts[0].body).toBe('Could not file an approval: HYDI_SERVICE_SECRET is not set on this host. Nothing was run.');
  });

  it('files over HTTP with a signed service token, an idempotency key and confirm:false', async () => {
    const calls = [];
    const fetch = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return { status: 202, ok: true, json: async () => ({ awaiting_approval: true, task: { id: 'b'.repeat(24), state: 'AWAITING_APPROVAL' } }) };
    });
    const h = harness({ fabric: undefined, deps: { fabric: undefined, fetch, apiBase: 'http://127.0.0.1:3000', serviceSecret: () => 's3cret' } });
    await h.responder.tick([req('a3', 'restart heidi-web')]);
    const { url, init } = calls[0];
    expect(url).toBe('http://127.0.0.1:3000/api/mobile-ops/fabric');
    expect(init.headers['x-idempotency-key']).toBe('board:a3');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ capability: 'board.request', args: { board_message_id: 'a3', request: 'restart heidi-web' }, confirm: false, objective: 'restart heidi-web' });
    const [ts, rid, service, sig] = init.headers['x-hydi-service-token'].split('.');
    expect(service).toBe('heidi-ops-responder');
    expect(sig).toBe(crypto.createHmac('sha256', 's3cret').update(`${ts}:${rid}:${service}`).digest('hex'));
    expect(h.posts[0].body).toContain(`Approval filed: ${'b'.repeat(24)}`);
  });

  it('rate-limits replies and leaves the rest for the next minute', async () => {
    const h = harness();
    const msgs = Array.from({ length: REPLY_LIMIT + 2 }, (_, i) => req(`q${i}`, 'disk'));
    await h.responder.tick(msgs);
    expect(h.posts).toHaveLength(REPLY_LIMIT);
    await h.responder.tick(msgs);
    expect(h.posts).toHaveLength(REPLY_LIMIT);
    h.advance(61_000);
    await h.responder.tick(msgs);
    expect(h.posts).toHaveLength(REPLY_LIMIT + 2);
  });

  it('posts the outcome in the same thread once a decision lands', async () => {
    const id = 'c'.repeat(24);
    const state = { value: { id, state: 'AWAITING_APPROVAL' } };
    const fabric = {
      file: async () => ({ ok: true, task: { id, state: 'AWAITING_APPROVAL' } }),
      get: jest.fn(async () => ({ ok: true, task: state.value, detail: {} })),
    };
    const h = harness({ fabric });
    const msgs = [req('o1', 'restart heidi-web')];
    await h.responder.tick(msgs);
    await h.responder.tick(msgs);
    expect(h.posts).toHaveLength(1);
    state.value = { id, state: 'CANCELLED' };
    await h.responder.tick(msgs);
    await h.responder.tick(msgs);
    expect(h.posts).toHaveLength(2);
    expect(h.posts[1]).toEqual({ channel: 'ops', body: `Approval ${id} was rejected. Nothing was run.`, replyTo: 'o1' });
  });
});

describe('outcomeText never reports done without a result', () => {
  const id = 'd'.repeat(24);
  it('pending → nothing to post', () => {
    expect(outcomeText({ id, state: 'AWAITING_APPROVAL' }, { authorization: { expires_at: new Date(T0 + 1000).toISOString() } }, T0)).toBeNull();
  });
  it('expired', () => {
    expect(outcomeText({ id, state: 'AWAITING_APPROVAL' }, { authorization: { expires_at: new Date(T0 - 1).toISOString() } }, T0)).toMatch(/expired without a decision\. Nothing was run\./);
    expect(outcomeText({ id, state: 'NEEDS_HUMAN' }, {}, T0)).toMatch(/expired/);
  });
  it('completed without a recorded result is not "done"', () => {
    for (const outcome of [undefined, { ok: true }, { ok: false, result: { result: { note: 'x' } } }, { ok: true, result: { result: {} } }]) {
      const text = outcomeText({ id, state: 'COMPLETED', outcome }, {}, T0);
      expect(text).toBe(`Approval ${id} was approved, but no result was recorded, so it is not reported as done.`);
    }
  });
  it('completed with a result quotes it', () => {
    const text = outcomeText({ id, state: 'COMPLETED', outcome: { ok: true, result: { result: { note: 'Approved by an operator.' } } } }, {}, T0);
    expect(text).toBe(`Approval ${id} was approved. Result: Approved by an operator.`);
  });
  it('failed quotes the error', () => {
    expect(outcomeText({ id, state: 'FAILED' }, { errors: [{ message: 'boom' }] }, T0)).toBe(`Approval ${id} was approved but failed: boom.`);
  });
});

describe('board.request in the real execution-fabric queue', () => {
  function gateway() {
    return new ExecutionGateway({ store: new TaskStore({ now: () => Date.now() }), skipRecovery: true });
  }

  it('waits for fabric:control approval and never executes the text', async () => {
    const gw = gateway();
    const filed = await gw.submit({ capabilityId: 'board.request', args: { board_message_id: 'm1', request: 'restart heidi-web' }, confirm: false, role: 'owner', objective: 'restart heidi-web', idempotencyKey: 'board:m1' });
    expect(filed.awaiting_approval).toBe(true);
    expect(filed.task.state).toBe('AWAITING_APPROVAL');
    const again = await gw.submit({ capabilityId: 'board.request', args: {}, confirm: false, role: 'owner', idempotencyKey: 'board:m1' });
    expect(again.duplicate).toBe(true);
    expect(await gw.approveTask(filed.task.id, 'viewer', true)).toMatchObject({ ok: false, error: 'forbidden' });
    const approved = await gw.approveTask(filed.task.id, 'operator', true);
    expect(approved.task.state).toBe('COMPLETED');
    const got = await gw.getTask(filed.task.id, 'operator');
    expect(got.task.outcome.result.result).toMatchObject({ approved: true, executed: false });
    expect(outcomeText(got.task, got.detail)).toMatch(/was approved\. Result: Approved by an operator\. No automated executor runs board requests/);
  });

  it('cannot be filed or self-approved by a status:view caller', async () => {
    const gw = gateway();
    expect(await gw.submit({ capabilityId: 'board.request', args: {}, confirm: true, role: 'viewer' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await gw.submit({ capabilityId: 'board.request', args: {}, confirm: true, role: 'agent' })).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('cancel reads as rejected', async () => {
    const gw = gateway();
    const filed = await gw.submit({ capabilityId: 'board.request', args: {}, confirm: false, role: 'owner' });
    await gw.cancel(filed.task.id, 'operator');
    const got = await gw.getTask(filed.task.id, 'operator');
    expect(outcomeText(got.task, got.detail)).toBe(`Approval ${filed.task.id} was rejected. Nothing was run.`);
  });
});

describe('ops responder hardening', () => {
  it('reads allowed senders from env, default Jordan and hydi-daemon', () => {
    expect([...allowedSenders(undefined)]).toEqual(['jordan', 'hydi-daemon']);
    expect([...allowedSenders(' Jordan , ops-bot ')]).toEqual(['jordan', 'ops-bot']);
  });

  it('refuses a non-allowed agent once, with no read and no approval', async () => {
    const h = harness();
    const msgs = [req('x1', 'disk space', 1, 'Rex', 'agent'), req('x2', 'restart heidi-web', 1, 'Rex', 'agent')];
    await h.responder.tick(msgs);
    await h.responder.tick(msgs);
    expect(h.posts).toEqual([
      { channel: 'ops', body: REFUSAL, replyTo: 'x1' },
      { channel: 'ops', body: REFUSAL, replyTo: 'x2' },
    ]);
    expect(h.execCalls).toEqual([]);
    expect(h.deps.fabric.file).not.toHaveBeenCalled();
    expect(h.responder.state().handled.x1).toMatchObject({ kind: 'refused', sender: 'Rex' });
  });

  it('a human not on the list is refused too', async () => {
    const h = harness();
    await h.responder.tick([req('x3', 'disk', 1, 'Mallory', 'human')]);
    expect(h.posts[0].body).toBe(REFUSAL);
  });

  it('Jordan (human) and hydi-daemon are still served', async () => {
    const h = harness();
    await h.responder.tick([req('j1', 'disk', 2, 'Jordan', 'human'), req('d1', 'restart heidi-web', 1)]);
    expect(h.posts[0]).toMatchObject({ replyTo: 'j1' });
    expect(h.posts[0].body).toContain('GB free');
    expect(h.posts[1].body).toContain('waiting for Jordan');
    expect(h.deps.fabric.file).toHaveBeenCalledTimes(1);
  });

  it('HEIDI_OPS_REQUEST_SENDERS can narrow the list', async () => {
    const h = harness({ deps: { requestSenders: 'Jordan' } });
    await h.responder.tick([req('d2', 'disk', 1)]);
    expect(h.posts[0].body).toBe(REFUSAL);
  });

  it('runs the assessment crew at most once per hour, persisted across restarts', async () => {
    const stateFile = tmpState();
    const a = harness({ stateFile });
    await a.responder.tick([req('c1', 'run the assessment crew', 3)]);
    const crewRuns = (h) => h.execCalls.filter((c) => String(c[1] || '').endsWith('heidi-assessment-crew.js'));
    expect(crewRuns(a)).toHaveLength(1);
    expect(a.posts[0].body).toContain('Report thread crew-1 on #ops');

    const b = harness({ stateFile });
    b.advance(30 * 60 * 1000);
    await b.responder.tick([req('c2', 'assessment please', 1)]);
    expect(crewRuns(b)).toHaveLength(0);
    const ran = new Date(T0).toISOString();
    const next = new Date(T0 + ASSESSMENT_COOLDOWN_MS).toISOString();
    expect(b.posts[0].body).toContain(`Assessment ran at ${ran}; next allowed after ${next}. Latest report: thread crew-1.`);

    b.advance(31 * 60 * 1000);
    await b.responder.tick([req('c3', 'run the crew', 1)]);
    expect(crewRuns(b)).toHaveLength(1);
  });

  it('warns once and posts once to #alerts when HYDI_SERVICE_SECRET is missing', async () => {
    const stateFile = tmpState();
    const a = harness({ stateFile, deps: { serviceSecret: () => '' } });
    await a.responder.tick([]);
    await a.responder.tick([]);
    expect(a.deps.warn).toHaveBeenCalledTimes(1);
    expect(a.deps.warn.mock.calls[0][0]).toContain('HYDI_SERVICE_SECRET not set');
    expect(a.posts).toEqual([{ channel: 'alerts', body: SECRET_ALERT, replyTo: undefined }]);

    const b = harness({ stateFile, deps: { serviceSecret: () => '' } });
    await b.responder.tick([]);
    expect(b.deps.warn).toHaveBeenCalledTimes(1);
    expect(b.posts).toEqual([]);
  });

  it('stays quiet when the secret is set and never puts its value in a message', async () => {
    const h = harness({ deps: { serviceSecret: () => 'super-secret-value' } });
    await h.responder.tick([req('s1', 'disk')]);
    expect(h.deps.warn).not.toHaveBeenCalled();
    expect(h.posts.every((p) => !p.body.includes('super-secret-value'))).toBe(true);
    expect(h.posts.some((p) => p.channel === 'alerts')).toBe(false);
  });
});
