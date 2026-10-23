/**
 * Runtime-identity tests for the Phase 11 chaos harness.
 * These tests do not require a live Docker daemon — child_process.execFile is mocked.
 */

const path = require('path');

jest.mock('child_process', () => ({
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

const { execFile } = require('child_process');
const { WslExecutor } = require('../../../src/heidi-executive/WslExecutor');
const {
  runtimeIdentity,
  resolveComposeService,
  DockerServiceRestartScenario,
} = require('../../../scripts/lib/soak-chaos');

function mockExecFile(map) {
  execFile.mockImplementation((cmd, args, options, cb) => {
    if (!cb) {
      // overload where options is the callback
      cb = options;
      options = {};
    }
    const key = `${cmd} ${args.join(' ')}`;
    const match = map.find((m) => key.startsWith(m.key));
    if (match) {
      cb(null, match.stdout || '', '');
    } else {
      cb(new Error(`unexpected command: ${key}`), '', `stderr for ${key}`);
    }
    return { pid: 0 };
  });
}

describe('soak-chaos runtime identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFile([
      { key: 'docker version --format', stdout: '29.7.2' },
      { key: 'docker context show', stdout: 'desktop-linux' },
      { key: 'docker ps --all --format', stdout: 'ursula-postgres:abc123\nursula-redis:def456' },
    ]);
  });

  test('runtimeIdentity uses the Windows docker CLI and returns server version, context and containers', async () => {
    const id = await runtimeIdentity();
    expect(id.client).toBe('Windows docker CLI');
    expect(id.serverVersion).toBe('29.7.2');
    expect(id.context).toBe('desktop-linux');
    expect(id.containers).toContain('ursula-postgres:abc123');
    expect(id.containers).toContain('ursula-redis:def456');
    expect(execFile).toHaveBeenCalledWith('docker', expect.any(Array), expect.any(Object), expect.any(Function));
  });

  test('resolveComposeService returns the container id when the service is running', async () => {
    execFile.mockReset();
    execFile.mockImplementation((cmd, args, options, cb) => {
      if (!cb) cb = options;
      const key = args.join(' ');
      if (key.includes('ps -q postgres')) cb(null, 'abc123\n', '');
      else cb(new Error('bad command'), '', '');
    });
    const resolved = await resolveComposeService('C:\\ProtoForge_Ecosystem\\Ursula_Suite', 'postgres');
    expect(resolved.ok).toBe(true);
    expect(resolved.target).toBe('postgres');
    expect(resolved.containerId).toBe('abc123');
  });

  test('resolveComposeService rejects missing service', async () => {
    execFile.mockReset();
    execFile.mockImplementation((cmd, args, options, cb) => {
      if (!cb) cb = options;
      cb(null, '\n', '');
    });
    const resolved = await resolveComposeService('C:\\ProtoForge_Ecosystem\\Ursula_Suite', 'ghost');
    expect(resolved.ok).toBe(false);
    expect(resolved.target).toBe('ghost');
  });

  test('DockerServiceRestartScenario.resolve uses Windows docker compose and returns the container id', async () => {
    execFile.mockReset();
    execFile.mockImplementation((cmd, args, options, cb) => {
      if (!cb) cb = options;
      const key = args.join(' ');
      if (key.includes('ps -q redis')) cb(null, 'def456\n', '');
      else cb(new Error('bad command'), '', '');
    });
    const scenario = new DockerServiceRestartScenario('redis', {
      cwd: 'C:\\ProtoForge_Ecosystem\\Ursula_Suite',
    });
    const resolved = await scenario.resolve();
    expect(resolved.ok).toBe(true);
    expect(resolved.target).toBe('redis');
    expect(resolved.containerId).toBe('def456');
    expect(resolved.runtime).toBe('Windows docker compose');
  });
});

describe('WslExecutor identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFile([
      { key: 'docker version --format', stdout: '29.7.2' },
      { key: 'docker context show', stdout: 'desktop-linux' },
      { key: 'docker ps --all --format', stdout: 'ursula-flask:789xyz' },
    ]);
  });

  test('WslExecutor.identity uses the Windows docker CLI, not WSL docker', async () => {
    const wsl = new WslExecutor();
    const id = await wsl.identity();
    expect(id.client).toBe('Windows docker CLI via WslExecutor');
    expect(id.serverVersion).toBe('29.7.2');
    expect(id.context).toBe('desktop-linux');
    expect(id.containers).toContain('ursula-flask:789xyz');
    const dockerCalls = execFile.mock.calls.filter((c) => c[0] === 'docker');
    const wslCalls = execFile.mock.calls.filter((c) => c[0] === 'wsl');
    expect(dockerCalls.length).toBeGreaterThan(0);
    expect(wslCalls.length).toBe(0);
  });
});
