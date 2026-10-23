/**
 * Supervisor lifecycle and process-ownership tests.
 * These tests do not spawn real child processes — child_process is mocked.
 */

const child_process = jest.createMockFromModule('child_process');

jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));

// Force dry-run so supervisor.js does not launch real services.
process.argv = ['node', 'supervisor.js', '--dry-run'];

const { killProcessTree, supervisor } = require('../../../supervisor');

function makeMockProc(pid, exitCode = null, killed = false) {
  const listeners = {};
  return {
    pid,
    killed,
    exitCode,
    once: jest.fn((event, cb) => { listeners[event] = cb; }),
    removeAllListeners: jest.fn(),
    kill: jest.fn((sig) => { if (sig === 'SIGKILL') return true; return true; }),
    _emit: (event, ...args) => (listeners[event] ? listeners[event](...args) : undefined),
  };
}

describe('Supervisor ownership', () => {
  test('supervisor object records its own pid and ownership map', () => {
    expect(supervisor.pid).toBe(process.pid);
    expect(supervisor.ownership).toBeDefined();
  });
});

describe('killProcessTree on Windows', () => {
  const { exec } = require('child_process');

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: process.platform });
  });

  test('kills the shell process and its descendants with taskkill /F /T /PID', async () => {
    const proc = makeMockProc(12345);
    const p = killProcessTree(proc, 'next-app');

    // The mock proc has not exited, and the timeout is 10 s. Emit exit to keep tests fast.
    proc._emit('exit');
    await p;

    expect(exec).toHaveBeenCalledWith('taskkill /F /T /PID 12345', expect.any(Function));
    expect(proc.kill).not.toHaveBeenCalled();
  });

  test('falls back to SIGTERM if taskkill returns an error', async () => {
    const proc = makeMockProc(12346);
    const p = killProcessTree(proc, 'heidi-bridge');

    const execCall = exec.mock.calls.find((c) => c[0].includes('taskkill /F /T /PID 12346'));
    expect(execCall).toBeDefined();

    // Simulate taskkill error callback
    const cb = execCall[1];
    cb(new Error('taskkill failed'), '', '');

    proc._emit('exit');
    await p;

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
