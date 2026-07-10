'use strict';

/**
 * Unit tests for scripts/mission-cli.js. memory is mocked throughout -- no
 * real database is touched.
 */

const { parseFlags, cmdCreate, cmdList, cmdCancel } = require('../../scripts/mission-cli');

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
    expect(memory.createMission).toHaveBeenCalledWith('fix the thing', 1, null, null);
    expect(console.log).toHaveBeenCalledWith('created mission #7');
  });

  it('creates a mission with an explicit priority and assignee, no action', async () => {
    const memory = fakeMemory();
    await cmdCreate(memory, ['fix the thing', '--priority', '3', '--assign', 'Heidi']);
    expect(memory.createMission).toHaveBeenCalledWith('fix the thing', 3, null, 'Heidi');
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
      'Heidi'
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

  it('passes through status filter and limit', async () => {
    const memory = fakeMemory();
    memory.getMissions.mockResolvedValue([{ id: 1, status: 'pending', priority: 1, goal: 'x', assigned_agent: null }]);
    await cmdList(memory, ['--status', 'pending', '--limit', '5']);
    expect(memory.getMissions).toHaveBeenCalledWith('pending', 5);
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

describe('mission-cli: cmdCancel', () => {
  const realExit = process.exit;
  const realLog = console.log;
  beforeEach(() => {
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.log = jest.fn();
  });
  afterEach(() => {
    process.exit = realExit;
    console.log = realLog;
  });

  it('marks the mission cancelled', async () => {
    const memory = fakeMemory();
    await cmdCancel(memory, ['12']);
    expect(memory.updateMission).toHaveBeenCalledWith(12, 'cancelled');
    expect(console.log).toHaveBeenCalledWith('mission #12 cancelled');
  });

  it('reports not-found when updateMission changes nothing', async () => {
    const memory = fakeMemory();
    memory.updateMission.mockResolvedValue(0);
    await cmdCancel(memory, ['999']);
    expect(console.log).toHaveBeenCalledWith('mission #999 not found');
  });

  it('refuses a missing/non-numeric id', async () => {
    const memory = fakeMemory();
    await expect(cmdCancel(memory, [])).rejects.toThrow('exit:1');
    expect(memory.updateMission).not.toHaveBeenCalled();
  });
});
