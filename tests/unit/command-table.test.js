'use strict';
// Per-binary command table — default deny, argv built from the table.
jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const ActionExecutor = require('../../heidi-core/actions/action-executor.js');

function fakeChild(code = 0, out = 'ok\n') {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  process.nextTick(() => {
    c.stdout.emit('data', out);
    c.emit('close', code);
  });
  return c;
}
// The descendant sweep spawns powershell — feed it a realistic process dump.
function sweepAware() {
  return (...a) => {
    if (a[0] === 'powershell') {
      return fakeChild(0, Array.from({ length: 150 }, (_, i) => `${1000 + i} 4`).join('\n'));
    }
    return fakeChild();
  };
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('command table — default deny', () => {
  let ex;
  beforeEach(() => {
    jest.clearAllMocks();
    ex = new ActionExecutor({});
  });

  it('removes shell/exec-capable binaries', async () => {
    for (const cmd of ['node', 'npx', 'bash', 'sh', 'powershell', 'pwsh', 'cmd', 'curl']) {
      await expect(ex.runCommand(cmd, ['--version'])).rejects.toThrow(/command table|unsafe argument|not in approved/);
    }
  });

  it('npm: blocks exec/install/ci/publish and unknown flags', async () => {
    await expect(ex.runCommand('npm', ['exec', 'foo'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('npm', ['install'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('npm', ['ci'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('npm', ['publish'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('npm', ['test', '--userconfig', 'x'])).rejects.toThrow(/flag|extra args/);
    await expect(ex.runCommand('npm', ['test', '--registry', 'http://evil'])).rejects.toThrow(/flag|extra args/);
  });

  it('npm: --prefix outside approved roots refused', async () => {
    await expect(ex.runCommand('npm', ['--prefix', 'C:\\Windows\\System32', 'test'])).rejects.toThrow(/outside approved roots/);
  });
  it('npm: path traversal refused', async () => {
    await expect(ex.runCommand('npm', ['--prefix', '..\\..\\Windows', 'test'])).rejects.toThrow(/unsafe argument|outside/);
  });

  it('git: read-only subcommands only', async () => {
    spawn.mockImplementation(sweepAware());
    await expect(ex.runCommand('git', ['push', 'origin', 'main'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('git', ['commit', '-m', 'x'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('git', ['merge', 'x'])).rejects.toThrow(/not permitted/);
    await expect(ex.runCommand('git', ['-c', 'core.sshCommand=x', 'status'])).rejects.toThrow(/not permitted|unsafe argument/);
  });
  it('git: exec-capable flags refused', async () => {
    await expect(ex.runCommand('git', ['status', '--exec', 'rm'])).rejects.toThrow(/not permitted|unsafe argument/);
    await expect(ex.runCommand('git', ['fetch', '--upload-pack', 'x'])).rejects.toThrow(/not permitted/);
  });

  it('allowed: real npm --version runs', async () => {
    spawn.mockImplementation(sweepAware());
    if (process.platform === 'win32') {
      await ex.runCommand('npm', ['--version']);
      expect(spawn.mock.calls[0][0]).toBe(process.execPath);
      expect(spawn.mock.calls[0][1][0]).toMatch(/npm-cli\.js$/);
    }
  });

  it('allowed: npm --prefix <root> test passes validation', async () => {
    spawn.mockImplementation(sweepAware());
    await ex.runCommand('npm', ['--prefix', REPO_ROOT, 'test']);
    if (process.platform === 'win32') {
      const argv = spawn.mock.calls[0][1];
      expect(argv).toContain('--prefix');
      expect(argv).toContain('test');
    }
  }, 60000);
});
