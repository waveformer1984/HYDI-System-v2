'use strict';

/**
 * Heidi task lifecycle: heidi-core/missions/{lifecycle,mission-worker}.js on
 * the real legacy store (heidi-core/memory/sqlite-store.js). Every suite runs
 * twice: on a SQLite file and on the in-memory fallback used when the native
 * sqlite3 module can't load. Actions are faked except where a test says so;
 * nothing real is ever executed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const lifecycle = require('../../heidi-core/missions/lifecycle');
const MissionWorker = require('../../heidi-core/missions/mission-worker');

function loadStore(ram) {
  let Store;
  jest.isolateModules(() => {
    if (ram) jest.doMock('sqlite3', () => { throw new Error('no native sqlite3 here'); });
    Store = require('../../heidi-core/memory/sqlite-store');
  });
  jest.dontMock('sqlite3');
  return Store;
}

let sqliteAvailable = true;
try { require('sqlite3'); } catch { sqliteAvailable = false; }

const BACKENDS = [['RAM', true], ...(sqliteAvailable ? [['SQLite', false]] : [])];

const quiet = { log: () => {} };
const RUN = { type: 'run_command', command: 'git', args: ['status'] };
const LOG = { type: 'log_event', target: 'test', payload: { a: 1 } };

function fakeActions({ safe = true, execute } = {}) {
  return {
    isSafe: jest.fn().mockReturnValue(safe),
    execute: jest.fn(execute || (async () => ({ success: true, result: { stdout: 'On branch clean-main\n', stderr: '', exitCode: 0 } }))),
  };
}

let savedArmed;
beforeEach(() => { savedArmed = process.env.HEIDI_AUTONOMOUS_ACTIONS; delete process.env.HEIDI_AUTONOMOUS_ACTIONS; });
afterEach(() => {
  if (savedArmed === undefined) delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
  else process.env.HEIDI_AUTONOMOUS_ACTIONS = savedArmed;
});

describe.each(BACKENDS)('task lifecycle on the %s store', (_name, ram) => {
  let memory;
  let dir;

  beforeEach(async () => {
    const Store = loadStore(ram);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-tasks-'));
    memory = new Store({ dbPath: path.join(dir, 'heidi_memory.db') });
    await memory.initialize();
    await memory.registerAgent('Heidi', 'orchestrator', null, 0);
    await memory.setAgentPermission('Heidi', 3);
  });
  afterEach(async () => {
    if (memory.db) await memory.close();
  });

  const create = (goal, action, extra = {}) => memory.createMission(goal, 1, action ? { action, ...extra } : null, action ? 'Heidi' : null, { actor: 'test' });
  const states = async (id) => (await memory.getMissionEvents(id)).map((e) => e.to_state);
  const reload = (id) => memory.getMission(id);

  describe('state machine', () => {
    it('creates tasks as queued with a creation event', async () => {
      const id = await create('look around', LOG);
      expect((await reload(id)).status).toBe('queued');
      const [e] = await memory.getMissionEvents(id);
      expect(e).toMatchObject({ from_state: null, to_state: 'queued', actor: 'test', reason: 'created' });
    });

    it('refuses moves that are not in the transition table', async () => {
      const id = await create('x', RUN);
      expect(await lifecycle.transition(memory, id, 'running', { actor: 't' })).toMatchObject({ ok: false, error: `task ${id} is queued; it can't move to running` });
      expect(await lifecycle.transition(memory, id, 'nonsense', { actor: 't' })).toMatchObject({ ok: false });
      expect(await lifecycle.transition(memory, id, 'cancelled', {})).toMatchObject({ ok: false, error: 'actor is required' });
      expect(await lifecycle.transition(memory, 9999, 'cancelled', { actor: 't' })).toMatchObject({ ok: false, error: 'task 9999 not found' });
      expect((await lifecycle.transition(memory, id, 'cancelled', { actor: 't' })).ok).toBe(true);
      // terminal: nothing leaves cancelled
      for (const to of ['queued', 'running', 'completed']) expect((await lifecycle.transition(memory, id, to, { actor: 't' })).ok).toBe(false);
    });

    it('only the worker can finish a task with an action; informational tasks can be closed by hand', async () => {
      const act = await create('run it', RUN);
      expect(await lifecycle.transition(memory, act, 'completed', { actor: 'Heidi' })).toMatchObject({ ok: false, error: expect.stringMatching(/only the worker/) });
      const info = await create('remember to call the bank');
      expect((await lifecycle.transition(memory, info, 'completed', { actor: 'Heidi', reason: 'called' })).ok).toBe(true);
    });

    it('a conditional write means one claim wins when two workers race', async () => {
      const id = await create('race', LOG);
      const results = await Promise.all([
        lifecycle.transition(memory, id, 'planning', { actor: 'a', from: 'queued' }),
        lifecycle.transition(memory, id, 'planning', { actor: 'b', from: 'queued' }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect((await states(id)).filter((s) => s === 'planning')).toHaveLength(1);
    });
  });

  describe('worker: no approval needed', () => {
    it('runs a read-only task through planning, running, verifying to completed (dry run, says so)', async () => {
      const actions = fakeActions();
      const worker = new MissionWorker(memory, actions, quiet);
      const id = await create('log a marker', LOG);
      await worker.tick();
      const m = await reload(id);
      expect(m.status).toBe('completed');
      expect(await states(id)).toEqual(['queued', 'planning', 'running', 'verifying', 'completed']);
      expect(actions.execute).not.toHaveBeenCalled();
      const ev = lifecycle.parseJson(m.evidence);
      expect(ev.outcome).toBe('dry_run');
      expect(ev.checks[0].detail).toMatch(/nothing ran/);
      expect(lifecycle.parseJson(m.approval)).toMatchObject({ required: false, reason: 'read-only action' });
      expect(lifecycle.parseJson(m.result)).toMatchObject({ dryRun: true });
    });

    it('leaves bare-goal tasks alone', async () => {
      const worker = new MissionWorker(memory, fakeActions(), quiet);
      const id = await create('think about pricing');
      await worker.tick();
      expect((await reload(id)).status).toBe('queued');
    });
  });

  describe('worker: approval', () => {
    it('waits for a person, then re-checks, runs, verifies and records evidence', async () => {
      process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true';
      const actions = fakeActions();
      const worker = new MissionWorker(memory, actions, quiet);
      const id = await create('check the tree', RUN);

      await worker.tick();
      let m = await reload(id);
      expect(m.status).toBe('awaiting_approval');
      expect(actions.execute).not.toHaveBeenCalled();
      const approval = lifecycle.parseJson(m.approval);
      expect(approval).toMatchObject({ required: true, decision: null });
      expect(Date.parse(approval.expires_at) - Date.parse(approval.requested_at)).toBe(24 * 3600 * 1000);
      expect(lifecycle.parseJson(m.plan)).toMatchObject({ requiredLevel: 3, agentLevel: 3, armed: true });

      // Ticking again without a decision changes nothing.
      await worker.tick();
      expect((await reload(id)).status).toBe('awaiting_approval');

      // The model can't approve; a person can.
      expect(await lifecycle.decide(memory, id, 'approve', { actor: 'Heidi' })).toMatchObject({ ok: false, error: 'only a person can approve or reject a task' });
      expect((await lifecycle.decide(memory, id, 'approve', { actor: 'human:owner', reason: 'go' })).ok).toBe(true);
      expect(await lifecycle.decide(memory, id, 'approve', { actor: 'human:owner' })).toMatchObject({ ok: false, error: `task ${id} was already approved` });

      await worker.tick();
      m = await reload(id);
      expect(m.status).toBe('completed');
      expect(actions.execute).toHaveBeenCalledWith(RUN);
      expect(actions.isSafe).toHaveBeenCalledTimes(2); // at planning, and again after approval
      const ev = lifecycle.parseJson(m.evidence);
      expect(ev.outcome).toBe('success');
      expect(ev.checks).toEqual([
        { check: 'executed', pass: true, detail: 'action returned without error' },
        { check: 'exit code 0', pass: true, detail: 'exit code 0' },
      ]);
      expect(ev.output).toBe('On branch clean-main');
      const events = await memory.getMissionEvents(id);
      expect(events.map((e) => [e.to_state, e.actor])).toEqual([
        ['queued', 'test'],
        ['planning', 'mission-worker'],
        ['awaiting_approval', 'mission-worker'],
        ['awaiting_approval', 'human:owner'],
        ['running', 'mission-worker'],
        ['verifying', 'mission-worker'],
        ['completed', 'mission-worker'],
      ]);
      expect(lifecycle.formatTask(m, events)).toMatch(/Approval: approved by human:owner/);
    });

    it('rejecting cancels it and nothing runs', async () => {
      process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true';
      const actions = fakeActions();
      const worker = new MissionWorker(memory, actions, quiet);
      const id = await create('check the tree', RUN);
      await worker.tick();
      expect((await lifecycle.decide(memory, id, 'reject', { actor: 'human:owner', reason: 'not now' })).ok).toBe(true);
      await worker.tick();
      const m = await reload(id);
      expect(m.status).toBe('cancelled');
      expect(lifecycle.parseJson(m.approval)).toMatchObject({ decision: 'rejected', decided_by: 'human:owner', note: 'not now' });
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it('a permission dropped while waiting blocks it after approval', async () => {
      process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true';
      const actions = fakeActions();
      const worker = new MissionWorker(memory, actions, quiet);
      const id = await create('check the tree', RUN);
      await worker.tick();
      await memory.setAgentPermission('Heidi', 1);
      await lifecycle.decide(memory, id, 'approve', { actor: 'human:owner' });
      await worker.tick();
      const m = await reload(id);
      expect(m.status).toBe('blocked');
      expect(lifecycle.parseJson(m.evidence).error).toMatch(/after approval: Heidi is level 1/);
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it('an unanswered request expires and is cancelled; a late approval is refused', async () => {
      let t = Date.parse('2026-10-29T12:00:00Z');
      const worker = new MissionWorker(memory, fakeActions(), { ...quiet, now: () => t, approvalTtlMs: 60000 });
      const id = await create('check the tree', RUN);
      await worker.tick();
      t += 61000;
      expect(await lifecycle.decide(memory, id, 'approve', { actor: 'human:owner', now: t })).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
      await worker.tick();
      const m = await reload(id);
      expect(m.status).toBe('cancelled');
      expect(lifecycle.parseJson(m.approval).decision).toBe('expired');
    });
  });

  describe('worker: verification', () => {
    beforeEach(() => { process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true'; });
    const approveAndRun = async (worker, id) => {
      await worker.tick();
      await lifecycle.decide(memory, id, 'approve', { actor: 'human:owner' });
      await worker.tick();
      return reload(id);
    };

    it('an action that throws is failed with the error as evidence', async () => {
      const worker = new MissionWorker(memory, fakeActions({ execute: async () => { throw new Error('Process exited with code 128: not a git repository'); } }), quiet);
      const id = await create('check the tree', RUN);
      const m = await approveAndRun(worker, id);
      expect(m.status).toBe('failed');
      expect(await states(id)).toEqual(['queued', 'planning', 'awaiting_approval', 'awaiting_approval', 'running', 'verifying', 'failed']);
      expect(lifecycle.parseJson(m.evidence).checks[0]).toMatchObject({ check: 'executed', pass: false, detail: expect.stringMatching(/code 128/) });
    });

    it('success criteria that are not met fail the task even though it ran', async () => {
      const worker = new MissionWorker(memory, fakeActions(), quiet);
      const id = await create('check the tree', RUN, { success: { outputIncludes: 'nothing to commit' } });
      const m = await approveAndRun(worker, id);
      expect(m.status).toBe('failed');
      expect(lifecycle.parseJson(m.evidence).checks.pop()).toEqual({ check: 'output includes "nothing to commit"', pass: false, detail: 'not found' });
    });

    it('credential-looking output is hidden in the evidence', async () => {
      const key = ['sk', 'live', 'abcdefghijklmnop1234'].join('_');
      const worker = new MissionWorker(memory, fakeActions({ execute: async () => ({ success: true, result: { stdout: `ok\nSTRIPE=${key}\ndone`, exitCode: 0 } }) }), quiet);
      const id = await create('show env', RUN);
      const m = await approveAndRun(worker, id);
      expect(m.evidence).not.toContain(key);
      expect(lifecycle.parseJson(m.evidence).output).toBe('ok\n[line hidden: looked like a credential]\ndone');
    });
  });

  describe('worker: gates', () => {
    it('blocks without an agent, below the level, or when isSafe() refuses; fails an unknown type', async () => {
      const worker = new MissionWorker(memory, fakeActions({ safe: true }), quiet);
      const noAgent = await memory.createMission('x', 1, { action: RUN }, null, { actor: 't' });
      await worker.tick();
      expect((await reload(noAgent)).status).toBe('blocked');

      await memory.registerAgent('Kilo', 'hypotheses', null, 1);
      const low = await memory.createMission('x', 1, { action: RUN }, 'Kilo', { actor: 't' });
      await worker.tick();
      expect(lifecycle.parseJson((await reload(low)).evidence).error).toBe("Kilo is level 1, action 'run_command' requires level 3");

      const unsafe = new MissionWorker(memory, fakeActions({ safe: false }), quiet);
      const u = await create('x', RUN);
      await unsafe.tick();
      expect((await reload(u)).status).toBe('blocked');

      const odd = await create('x', { type: 'format_disk', target: 'C:' });
      await worker.tick();
      expect((await reload(odd)).status).toBe('failed');

      // A blocked task can be re-queued for another look.
      expect((await lifecycle.transition(memory, u, 'queued', { actor: 'Heidi', from: 'blocked' })).ok).toBe(true);
    });
  });

  describe('worker: restart recovery', () => {
    it('re-queues planning, fails running and verifying (never re-runs them)', async () => {
      const p = await create('a', LOG);
      const r = await create('b', RUN);
      const v = await create('c', RUN);
      await lifecycle.transition(memory, p, 'planning', { actor: 't' });
      for (const id of [r, v]) {
        await lifecycle.transition(memory, id, 'planning', { actor: 't' });
        await lifecycle.transition(memory, id, 'running', { actor: 't' });
      }
      await lifecycle.transition(memory, v, 'verifying', { actor: 't' });

      const actions = fakeActions();
      const worker = new MissionWorker(memory, actions, quiet);
      await worker.recover();
      expect((await reload(p)).status).toBe('queued');
      expect((await reload(r)).status).toBe('failed');
      expect(lifecycle.parseJson((await reload(r)).evidence).error).toMatch(/interrupted by a restart while running/);
      expect((await reload(v)).status).toBe('failed');
      expect(actions.execute).not.toHaveBeenCalled();
    });
  });

  describe('chat commands', () => {
    it('lists, shows, approves and cancels through the same rules', async () => {
      process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true';
      const worker = new MissionWorker(memory, fakeActions(), quiet);
      const id = await create('check the tree', RUN);
      const other = await create('look around', RUN);
      await worker.tick();

      expect((await reload(other)).status).toBe('queued'); // oldest first

      const list = await lifecycle.runTaskCommand(memory, { cmd: 'list' }, { actor: 'human:owner' });
      expect(list).toMatch(new RegExp(`✋ #${id} awaiting_approval \\[run_command\\] — check the tree`));
      expect(list).toMatch(new RegExp(`task approve ${id}`));

      const show = await lifecycle.runTaskCommand(memory, { cmd: 'show', id }, { actor: 'human:owner' });
      expect(show).toMatch(/Approval: NEEDED .*expires in 24 h/);
      expect(show).toMatch(/History:/);

      let nudged = null;
      const approved = await lifecycle.runTaskCommand(memory, { cmd: 'approve', id, note: 'ok' }, { actor: 'human:owner', onApproved: (x) => { nudged = x; } });
      expect(nudged).toBe(id);
      expect(approved).toMatch(/approved by human:owner/);

      expect(await lifecycle.runTaskCommand(memory, { cmd: 'cancel', id: other }, { actor: 'human:owner' })).toMatch(/CANCELLED/);
      expect(await lifecycle.runTaskCommand(memory, { cmd: 'show', id: 4242 }, { actor: 'human:owner' })).toBe('⚠️ Task #4242 not found.');
    });
  });
});

describe('legacy rows are migrated', () => {
  (sqliteAvailable ? it : it.skip)('renames pending/active, adds the columns, keeps the data', async () => {
    const sqlite3 = require('sqlite3');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-tasks-legacy-'));
    const dbPath = path.join(dir, 'heidi_memory.db');
    const db = new sqlite3.Database(dbPath);
    const run = (sql) => new Promise((res, rej) => db.run(sql, (e) => (e ? rej(e) : res())));
    await run(`CREATE TABLE missions (id INTEGER PRIMARY KEY AUTOINCREMENT, goal TEXT NOT NULL, status TEXT DEFAULT 'pending', priority INTEGER DEFAULT 1, assigned_agent TEXT, context TEXT, result TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME)`);
    await run(`INSERT INTO missions (goal, status) VALUES ('old pending', 'pending'), ('old active', 'active'), ('old done', 'completed')`);
    await new Promise((r) => db.close(r));

    const Store = loadStore(false);
    const memory = new Store({ dbPath });
    await memory.initialize();
    const rows = await memory.getMissions(null, 10);
    expect(Object.fromEntries(rows.map((r) => [r.goal, r.status]))).toEqual({ 'old pending': 'queued', 'old active': 'running', 'old done': 'completed' });
    expect(rows[0]).toHaveProperty('evidence');
    await memory.initialize.call(memory); // idempotent
    await memory.close();
  });
});

describe('approval policy', () => {
  const moduleIds = new Set(['heidi-mobile-chat']);
  it('read-only actions and a known module restart need no approval; everything else does', () => {
    expect(lifecycle.approvalPolicy(LOG, { env: {}, moduleIds }).required).toBe(false);
    expect(lifecycle.approvalPolicy({ type: 'read_file', target: 'README.md' }, { env: {}, moduleIds }).required).toBe(false);
    const restart = { type: 'run_script', target: lifecycle.RESTART_MODULE_SCRIPT, args: ['heidi-mobile-chat'] };
    expect(lifecycle.approvalPolicy(restart, { env: {}, moduleIds })).toMatchObject({ required: false, reason: expect.stringMatching(/standing approval/) });
    expect(lifecycle.approvalPolicy(restart, { env: { HEIDI_AUTO_APPROVE_RESTARTS: 'false' }, moduleIds }).required).toBe(true);
    expect(lifecycle.approvalPolicy({ ...restart, args: ['unknown-module'] }, { env: {}, moduleIds }).required).toBe(true);
    expect(lifecycle.approvalPolicy({ ...restart, args: ['heidi-mobile-chat', '--extra'] }, { env: {}, moduleIds }).required).toBe(true);
    expect(lifecycle.approvalPolicy({ type: 'run_script', target: 'scripts/other.js', args: [] }, { env: {}, moduleIds }).required).toBe(true);
    expect(lifecycle.approvalPolicy(RUN, { env: {}, moduleIds }).required).toBe(true);
  });
});

describe('parseTaskCommand', () => {
  it('recognises the commands and nothing else', () => {
    expect(lifecycle.parseTaskCommand('tasks')).toEqual({ cmd: 'list' });
    expect(lifecycle.parseTaskCommand(' Task list ')).toEqual({ cmd: 'list' });
    expect(lifecycle.parseTaskCommand('task 12')).toEqual({ cmd: 'show', id: 12 });
    expect(lifecycle.parseTaskCommand('task #12')).toEqual({ cmd: 'show', id: 12 });
    expect(lifecycle.parseTaskCommand('task approve 12 looks fine')).toEqual({ cmd: 'approve', id: 12, note: 'looks fine' });
    expect(lifecycle.parseTaskCommand('task reject 3')).toEqual({ cmd: 'reject', id: 3, note: null });
    expect(lifecycle.parseTaskCommand('task cancel')).toEqual({ cmd: 'usage' });
    for (const q of ['task force for the win', 'what tasks are there?', 'tasks please', 'taskapprove 1', 'task approve me']) {
      expect(lifecycle.parseTaskCommand(q)).toEqual(q === 'task approve me' ? { cmd: 'usage' } : null);
    }
  });

  it('stays fast on hostile input', () => {
    const t0 = Date.now();
    lifecycle.parseTaskCommand(`task approve 1${' '.repeat(100000)}x`);
    lifecycle.parseTaskCommand(`task${'\t '.repeat(50000)}`);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('MissionWorker: start/stop and reentrancy', () => {
  const stubMemory = () => ({ getMissions: jest.fn().mockResolvedValue([]) });

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('start() is idempotent (does not stack multiple intervals)', () => {
    const worker = new MissionWorker(stubMemory(), fakeActions(), { ...quiet, intervalMs: 1000 });
    worker.start();
    const firstTimer = worker.timer;
    worker.start();
    expect(worker.timer).toBe(firstTimer);
    worker.stop();
  });

  it('stop() clears the timer so no further ticks fire', () => {
    const memory = stubMemory();
    const worker = new MissionWorker(memory, fakeActions(), { ...quiet, intervalMs: 1000 });
    worker.start();
    worker.stop();
    jest.advanceTimersByTime(5000);
    expect(memory.getMissions).not.toHaveBeenCalled();
  });

  it('a slow tick is not re-entered by an overlapping timer fire', async () => {
    jest.useRealTimers();
    let release;
    const memory = { getMissions: jest.fn(() => new Promise((r) => { release = r; })) };
    const worker = new MissionWorker(memory, fakeActions(), { ...quiet, intervalMs: 10 });
    const first = worker.tick();
    await worker.tick(); // returns at once: reentrancy guard
    expect(memory.getMissions).toHaveBeenCalledTimes(1);
    memory.getMissions.mockResolvedValue([]);
    release([]);
    await first;
  });
});
