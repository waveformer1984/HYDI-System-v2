'use strict';
// npm launch adaptation + bounded timeout — mocked child_process, no real spawns.
jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');
const EventEmitter = require('events');
const ActionExecutor = require('../../heidi-core/actions/action-executor.js');

function fakeChild(code = 0, out = 'ok\n', err = '') {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  process.nextTick(() => {
    if (out) c.stdout.emit('data', out);
    if (err) c.stderr.emit('data', err);
    c.emit('close', code);
  });
  return c;
}

const IS_WIN = process.platform === 'win32';

describe('runCommand npm launch + timeout', () => {
  let ex;
  beforeEach(() => {
    jest.clearAllMocks();
    ex = new ActionExecutor({ approvedCommands: new Set(['npm', 'git', 'echo']) });
  });

  it('spawns the real command directly for non-npm', async () => {
    spawn.mockReturnValue(fakeChild());
    const p = ex.runCommand('git', ['status']);
    await expect(p).resolves.toHaveProperty('exitCode', 0);
    expect(spawn.mock.calls[0][0]).toBe('git');
  });

  (IS_WIN ? it : it.skip)('npm adapts to node + npm-cli.js on Windows', async () => {
    spawn.mockReturnValue(fakeChild());
    await ex.runCommand('npm', ['--prefix', 'C:\\x', 'test']);
    const [bin, argv] = spawn.mock.calls[0];
    expect(bin).toBe(process.execPath);
    expect(argv[0]).toMatch(/npm-cli\.js$/);
    expect(argv[1]).toBe('--prefix');
    expect(argv[3]).toBe('test');
  });

  it('bounded timeout: default 30s, cap 10min', async () => {
    spawn.mockImplementation(() => fakeChild());
    await ex.runCommand('git', ['status'], { timeout_ms: 5000 });
    expect(spawn.mock.calls[0][2].timeout).toBe(5000);
    await ex.runCommand('git', ['status'], { timeout_ms: 9999999 });
    expect(spawn.mock.calls[1][2].timeout).toBe(600000);
    await ex.runCommand('git', ['status']);
    expect(spawn.mock.calls[2][2].timeout).toBe(30000);
  });

  it('unapproved command still refused', async () => {
    await expect(ex.runCommand('curl', [])).rejects.toThrow(/not in approved/);
  });
  it('shell-metachar args still refused even through the npm adapter', async () => {
    await expect(ex.runCommand('npm', ['test', '&&', 'del', '/s', 'c:\\'])).rejects.toThrow(/unsafe argument/);
  });
});
