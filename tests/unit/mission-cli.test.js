'use strict';

/**
 * Unit tests for scripts/mission-cli.js. memory is mocked for create/list;
 * the task commands run on the in-memory store -- no database file is touched.
 */

const { parseFlags, cmdCreate, cmdList, cmdCancel, cmdTask } = require('../../scripts/mission-cli');

function fakeMemory() {
  return {
    createMission: jest.fn().mockResolvedValue(7),
    getMissions: jest.fn().mockResolvedValue([]),
    updateMission: jest.fn().mockResolvedValue(1),
  };
}

describe('mission-cli: parseFlags', () => {
  it('parses a value flag', () => {
    expect(parseFlags(['--priority', '2'])).toEqual({ priority: '2' });
  });

  it('parses a boolean flag with no following value', () => {
    expect(parseFlags(['--verbose'])).toEqual({ verbose: true });
  });

  it('treats a flag immediately followed by another flag as boolean', () => {
    expect(parseFlags(['--verbose', '--priority', '1'])).toEqual({ verbose: true, priority: '1' });
  });

  it('parses multiple flags', () => {
    expect(parseFlags(['--priority', '2', '--assign', 'Heidi'])).toEqual({ priority: '2', assign: 'Heidi' });
  });

  it('ignores positional (non-flag) args', () => {
    expect(parseFlags(['positional', '--priority', '2'])).toEqual({ priority: '2' });
  });
});

describe('mission-cli: cmdCreate', () => {
  const realExit = process.exit;
  const realError = console.error;
  const realLog = console.log;
  beforeEach(() => {
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.error = jest.fn();
    console.log = jest.fn();
  });
  afterEach(() => {
    process.exit = realExit;
    console.error = realError;
    console.log = realLog;
  });

  it('creates a bare-goal mission with default priority 1 and no context', async () => {
    const memory = fakeMemory();
    await cmdCreate(memory, ['fix the thing']);
    expect(memory.createMission).toHaveBeenCalledWith('fix the thing', 1, null, null, { actor: 'cli', reason: 'created with mission-cli' });
    expect(console.log).toHaveBeenCalledWith('created mission #7 (queued)');
  });

  it('creates a mission with an explicit priority and assignee, no action', async () => {
    const memory = fakeMemory();
    await cmdCreate(memory, ['fix the thing', '--priority', '3', '--assign', 'Heidi']);
    expect(memory.createMission).toHaveBeenCalledWith('fix the thing', 3, null, 'Heidi', { actor: 'cli', reason: 'created with mission-cli' });
  });

  it('creates a mission with a structured action when --assign is also given', async () => {
    const memory = fakeMemory();
    await cmdCreate(memory, [
      'restart mobile chat', '--assign', 'Heidi',
      '--action', '{"type":"run_script","target":"scripts/restart-module.js","args":["heidi-mobile-chat"]}',
    ]);
    expect(memory.createMission).toHaveBeenCalledWith(
      'restart mobile chat', 1,
      { action: { type: 'run_script', target: 'scripts/restart-module.js', args: ['heidi-mobile-chat'] } },
      'Heidi',
      { actor: 'cli', reason: 'created with mission-cli' }
    );
  });

  it('refuses --action without --assign', async () => {
    const memory = fakeMemory();
    await expect(cmdCreate(memory, ['x', '--action', '{"type":"run_command"}'])).rejects.toThrow('exit:1');
    expect(memory.createMission).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/--assign.*is required/));
  });

  it('refuses invalid JSON in --action', async () => {
    const memory = fakeMemory();
    await expect(cmdCreate(memory, ['x', '--assign', 'Heidi', '--action', '{not json'])).rejects.toThrow('exit:1');
    expect(memory.createMission).not.toHaveBeenCalled();
  });

  it('refuses a missing goal', async () => {
    const memory = fakeMemory();
    await expect(cmdCreate(memory, [])).rejects.toThrow('exit:1');
    expect(memory.createMission).not.toHaveBeenCalled();
  });
});

describe('mission-cli: cmdList', () => {
  const realLog = console.log;
  beforeEach(() => { console.log = jest.fn(); });
  afterEach(() => { console.log = realLog; });

  it('passes through status filter and limit, mapping old state names', async () => {
    const memory = fakeMemory();
    memory.getMissions.mockResolvedValue([{ id: 1, status: 'queued', priority: 1, goal: 'x', assigned_agent: null }]);
    await cmdList(memory, ['--status', 'pending', '--limit', '5']);
    expect(memory.getMissions).toHaveBeenCalledWith('queued', 5);
    await cmdList(memory, ['--status', 'awaiting_approval']);
    expect(memory.getMissions).toHaveBeenLastCalledWith('awaiting_approval', 20);
  });

  it('defaults to no status filter and limit 20', async () => {
    const memory = fakeMemory();
    await cmdList(memory, []);
    expect(memory.getMissions).toHaveBeenCalledWith(null, 20);
  });

  it('prints a friendly message for an empty result', async () => {
    const memory = fakeMemory();
    await cmdList(memory, []);
    expect(console.log).toHaveBeenCalledWith('no missions found');
  });
});

describe('mission-cli: cancel / approve through the task lifecycle', () => {
  const realExit = process.exit;
  const realLog = console.log;
  let memory;
  beforeEach(async () => {
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.log = jest.fn();
    let Store;
    jest.isolateModules(() => {
      jest.doMock('sqlite3', () => { throw new Error('RAM store for this test'); });
      Store = require('../../heidi-core/memory/sqlite-store');
    });
    jest.dontMock('sqlite3');
    memory = new Store({});
    await memory.initialize();
  });
  afterEach(() => {
    process.exit = realExit;
    console.log = realLog;
  });

  it('cancels a queued task and records the operator as a person', async () => {
    const id = await memory.createMission('x', 1, null, null, { actor: 'test' });
    await cmdCancel(memory, [String(id), 'not', 'needed']);
    expect((await memory.getMission(id)).status).toBe('cancelled');
    const last = (await memory.getMissionEvents(id)).pop();
    expect(last.actor).toMatch(/^human:cli:/);
    expect(last.reason).toBe('cancelled: not needed');
  });

  it('reports a missing task', async () => {
    await cmdCancel(memory, ['999']);
    expect(console.log).toHaveBeenCalledWith('⚠️ Task #999 not found.');
  });

  it('refuses a missing/non-numeric id', async () => {
    await expect(cmdCancel(memory, [])).rejects.toThrow('exit:1');
  });

  it('approves only a task that is waiting for approval', async () => {
    const id = await memory.createMission('x', 1, null, null, { actor: 'test' });
    await cmdTask(memory, 'approve', [String(id)]);
    expect(console.log).toHaveBeenLastCalledWith(`⚠️ task ${id} is queued, not awaiting approval`);
  });
});
