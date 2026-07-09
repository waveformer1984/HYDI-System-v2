'use strict';

/**
 * Unit tests for heidi-core/missions/mission-worker.js.
 * memory and actions are both mocked -- no I/O, no real command execution.
 */

const MissionWorker = require('../../heidi-core/missions/mission-worker');

function fakeMemory({ pending = [], agent = null } = {}) {
  return {
    getMissions: jest.fn().mockResolvedValue(pending),
    updateMission: jest.fn().mockResolvedValue(1),
    getAgent: jest.fn().mockResolvedValue(agent),
  };
}

function fakeActions({ safe = true } = {}) {
  return {
    isSafe: jest.fn().mockReturnValue(safe),
    execute: jest.fn(),
  };
}

const mission = (overrides = {}) => ({
  id: 1,
  goal: 'test goal',
  status: 'pending',
  priority: 1,
  assigned_agent: null,
  context: null,
  ...overrides,
});

describe('MissionWorker: claiming', () => {
  it('skips bare-goal missions with no structured action', async () => {
    const memory = fakeMemory({ pending: [mission({ context: null })] });
    const actions = fakeActions();
    const worker = new MissionWorker(memory, actions, { log: () => {} });

    const claimed = await worker.claimNext();
    expect(claimed).toBeNull();
    expect(memory.updateMission).not.toHaveBeenCalled();
  });

  it('skips a mission whose context is not valid JSON', async () => {
    const memory = fakeMemory({ pending: [mission({ context: '{not json' })] });
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    expect(await worker.claimNext()).toBeNull();
  });

  it('finds the first mission in the batch that DOES carry a structured action', async () => {
    const withAction = mission({
      id: 2,
      context: JSON.stringify({ action: { type: 'run_command', command: 'git', args: ['status'] } }),
      assigned_agent: 'Kilo',
    });
    const memory = fakeMemory({ pending: [mission({ id: 1 }), withAction] });
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });

    const claimed = await worker.claimNext();
    expect(claimed.mission.id).toBe(2);
    expect(claimed.action).toEqual({ type: 'run_command', command: 'git', args: ['status'] });
  });

  it('accepts context already parsed as an object (in-memory store path)', async () => {
    const memory = fakeMemory({
      pending: [mission({ context: { action: { type: 'log_event', target: 'x', payload: {} } }, assigned_agent: 'Heidi' })],
    });
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    const claimed = await worker.claimNext();
    expect(claimed.action.type).toBe('log_event');
  });
});

describe('MissionWorker: processMission gating', () => {
  const runCommandAction = { type: 'run_command', command: 'git', args: ['status'] };

  it('marks a mission active before evaluating it', async () => {
    const memory = fakeMemory();
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);
    expect(memory.updateMission).toHaveBeenCalledWith(1, 'active');
  });

  it('fails a mission with an unsupported action type without checking permissions', async () => {
    const memory = fakeMemory();
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    await worker.processMission(mission({ assigned_agent: 'Kilo' }), { type: 'mine_bitcoin' });

    expect(memory.updateMission).toHaveBeenCalledWith(1, 'failed', { error: expect.stringMatching(/unsupported action type/) });
    expect(memory.getAgent).not.toHaveBeenCalled();
  });

  it('blocks a mission with no assigned_agent', async () => {
    const memory = fakeMemory();
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    await worker.processMission(mission({ assigned_agent: null }), runCommandAction);

    expect(memory.updateMission).toHaveBeenCalledWith(1, 'blocked', { error: expect.stringMatching(/no assigned_agent/) });
  });

  it('blocks when the assigned agent is below the required level', async () => {
    const memory = fakeMemory({ agent: { name: 'Kilo', permission_level: 2, enabled: 1 } });
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);

    expect(memory.updateMission).toHaveBeenCalledWith(1, 'blocked', {
      error: expect.stringMatching(/level 2.*requires level 3/),
    });
  });

  it('treats a disabled agent as level 0', async () => {
    const memory = fakeMemory({ agent: { name: 'Kilo', permission_level: 4, enabled: 0 } });
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);

    expect(memory.updateMission).toHaveBeenCalledWith(1, 'blocked', {
      error: expect.stringMatching(/level 0/),
    });
  });

  it('treats an unregistered agent as level 0', async () => {
    const memory = fakeMemory({ agent: null });
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {} });
    await worker.processMission(mission({ assigned_agent: 'GhostAgent' }), runCommandAction);

    expect(memory.updateMission).toHaveBeenCalledWith(1, 'blocked', expect.objectContaining({
      error: expect.stringMatching(/level 0/),
    }));
  });

  it('blocks when the action fails isSafe(), even with sufficient permission', async () => {
    const memory = fakeMemory({ agent: { name: 'Kilo', permission_level: 4, enabled: 1 } });
    const actions = fakeActions({ safe: false });
    const worker = new MissionWorker(memory, actions, { log: () => {} });
    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);

    expect(memory.updateMission).toHaveBeenCalledWith(1, 'blocked', { error: expect.stringMatching(/isSafe/) });
    expect(actions.execute).not.toHaveBeenCalled();
  });
});

describe('MissionWorker: execution mode', () => {
  const runCommandAction = { type: 'run_command', command: 'git', args: ['status'] };
  const sufficientMemory = () => fakeMemory({ agent: { name: 'Kilo', permission_level: 3, enabled: 1 } });
  const realEnv = process.env.HEIDI_AUTONOMOUS_ACTIONS;

  afterEach(() => {
    if (realEnv === undefined) delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
    else process.env.HEIDI_AUTONOMOUS_ACTIONS = realEnv;
  });

  it('DRY RUNS by default (HEIDI_AUTONOMOUS_ACTIONS unset) -- never calls actions.execute', async () => {
    delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
    const memory = sufficientMemory();
    const actions = fakeActions();
    const worker = new MissionWorker(memory, actions, { log: () => {} });

    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);

    expect(actions.execute).not.toHaveBeenCalled();
    expect(memory.updateMission).toHaveBeenCalledWith(1, 'completed', { dryRun: true, wouldExecute: runCommandAction });
  });

  it('DRY RUNS when HEIDI_AUTONOMOUS_ACTIONS is set to anything other than the string "true"', async () => {
    process.env.HEIDI_AUTONOMOUS_ACTIONS = '1';
    const memory = sufficientMemory();
    const actions = fakeActions();
    const worker = new MissionWorker(memory, actions, { log: () => {} });

    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);
    expect(actions.execute).not.toHaveBeenCalled();
  });

  it('executes for real when armed, sufficient level, and safe', async () => {
    process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true';
    const memory = sufficientMemory();
    const actions = fakeActions();
    actions.execute.mockResolvedValue({ result: { stdout: 'clean\n', stderr: '', exitCode: 0 } });
    const worker = new MissionWorker(memory, actions, { log: () => {} });

    await worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction);

    expect(actions.execute).toHaveBeenCalledWith(runCommandAction);
    expect(memory.updateMission).toHaveBeenCalledWith(1, 'completed', { stdout: 'clean\n', stderr: '', exitCode: 0 });
  });

  it('marks failed (not thrown) when armed execution throws', async () => {
    process.env.HEIDI_AUTONOMOUS_ACTIONS = 'true';
    const memory = sufficientMemory();
    const actions = fakeActions();
    actions.execute.mockRejectedValue(new Error('boom'));
    const worker = new MissionWorker(memory, actions, { log: () => {} });

    await expect(worker.processMission(mission({ assigned_agent: 'Kilo' }), runCommandAction)).resolves.toBeUndefined();
    expect(memory.updateMission).toHaveBeenCalledWith(1, 'failed', { error: 'boom' });
  });
});

describe('MissionWorker: start/stop and reentrancy', () => {
  jest.useFakeTimers();
  afterEach(() => jest.clearAllTimers());

  it('start() is idempotent (does not stack multiple intervals)', () => {
    const worker = new MissionWorker(fakeMemory(), fakeActions(), { log: () => {}, intervalMs: 1000 });
    worker.start();
    const firstTimer = worker.timer;
    worker.start();
    expect(worker.timer).toBe(firstTimer);
    worker.stop();
  });

  it('stop() clears the timer so no further ticks fire', () => {
    const memory = fakeMemory();
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {}, intervalMs: 1000 });
    worker.start();
    worker.stop();
    jest.advanceTimersByTime(5000);
    expect(memory.getMissions).not.toHaveBeenCalled();
  });

  it('a slow tick is not re-entered by an overlapping timer fire', async () => {
    let resolveGetMissions;
    const memory = fakeMemory();
    memory.getMissions = jest.fn(() => new Promise((r) => { resolveGetMissions = r; }));
    const worker = new MissionWorker(memory, fakeActions(), { log: () => {}, intervalMs: 10 });

    const firstTick = worker.tick(); // in-flight, ticking=true
    await worker.tick();             // should return immediately (reentrancy guard)
    expect(memory.getMissions).toHaveBeenCalledTimes(1);

    resolveGetMissions([]);
    await firstTick;
  });
});
