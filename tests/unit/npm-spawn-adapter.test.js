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

// Real-launch fixture — no mock: proves the adapter actually starts the
// resolved npm CLI and captures a harmless result. `npm --version` is
// read-only and fast.
describe('npm adapter real launch (fixture)', () => {
  (process.platform === 'win32' ? it : it.skip)('npm --version launches and captures output', async () => {
    jest.unmock('child_process');
    const { spawn } = jest.requireActual('child_process');
    const ex = new ActionExecutor({});
    ex.spawnProcess = function (cmd, args, opts) {
      return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { shell: false, timeout: 30000, env: process.env });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('close', (code) => resolve({ stdout: out, exitCode: code }));
        child.on('error', reject);
      });
    };
    const r = await ex.runCommand('npm', ['--version']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 30000);
  it('invalid timeout_ms falls back to 30s default', async () => {
    spawn.mockImplementation(() => fakeChild());
    const ex = new ActionExecutor({});
    await ex.runCommand('git', ['status'], { timeout_ms: 'abc' });
    expect(spawn.mock.calls[0][2].timeout).toBe(30000); // NaN → 30s default
    await ex.runCommand('git', ['status'], { timeout_ms: -5 });
    expect(spawn.mock.calls[1][2].timeout).toBe(1000); // clamps to the 1s floor
  });
});
