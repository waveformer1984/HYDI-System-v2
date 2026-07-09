'use strict';

/**
 * Unit tests for scripts/restart-module.js -- process management is mocked
 * throughout, so this never spawns or kills a real process.
 */

jest.mock('child_process');
const cp = require('child_process');
const { restartModule, findPidOnPort, loadModule } = require('../../scripts/restart-module');

// This repo's own boot.config.json is used as-is (read-only), since it
// already has a real 'heidi-mobile-chat' module with a port -- no fixture
// file needed and no risk of drifting out of sync with the real config.

describe('restart-module: loadModule', () => {
  it('throws for an unknown module id', () => {
    expect(() => loadModule('not-a-real-module')).toThrow(/Unknown module id/);
  });

  it('resolves a real module id from boot.config.json', () => {
    const mod = loadModule('heidi-mobile-chat');
    expect(mod.id).toBe('heidi-mobile-chat');
    expect(mod.port).toBe(3006);
  });
});

describe('restart-module: findPidOnPort', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    jest.clearAllMocks();
  });

  it('parses the PID from a Windows netstat LISTENING line', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execFileSync.mockReturnValue(
      '  TCP    0.0.0.0:3006           0.0.0.0:0              LISTENING       14596\n' +
      '  TCP    127.0.0.1:3006         127.0.0.1:2000         TIME_WAIT       0\n'
    );
    expect(findPidOnPort(3006)).toBe('14596');
  });

  it('returns null when no LISTENING line matches the port', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execFileSync.mockReturnValue('  TCP    0.0.0.0:9999   0.0.0.0:0   LISTENING   111\n');
    expect(findPidOnPort(3006)).toBeNull();
  });

  it('returns null when the lookup command throws (nothing listening)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execFileSync.mockImplementation(() => { throw new Error('no matches'); });
    expect(findPidOnPort(3006)).toBeNull();
  });

  it('parses a PID from lsof on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    cp.execFileSync.mockReturnValue('23456\n');
    expect(findPidOnPort(3006)).toBe('23456');
    expect(cp.execFileSync).toHaveBeenCalledWith('lsof', ['-ti', 'tcp:3006'], expect.any(Object));
  });
});

describe('restart-module: restartModule', () => {
  const realPlatform = process.platform;
  let spawnedProc;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    spawnedProc = { pid: 99999, unref: jest.fn() };
    cp.spawn.mockReturnValue(spawnedProc);
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    jest.clearAllMocks();
  });

  it('kills the existing PID by port and spawns a detached replacement', () => {
    cp.execFileSync.mockImplementation((cmd) => {
      if (cmd === 'netstat') return '  TCP  0.0.0.0:3006  0.0.0.0:0  LISTENING  8948\n';
      if (cmd === 'taskkill') return '';
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = restartModule('heidi-mobile-chat', { log: () => {} });

    expect(cp.execFileSync).toHaveBeenCalledWith('taskkill', ['/PID', '8948', '/F']);
    expect(cp.spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining('boot-agent.js'), '--only=heidi-mobile-chat'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(spawnedProc.unref).toHaveBeenCalled();
    expect(result).toEqual({ id: 'heidi-mobile-chat', stoppedPid: '8948', supervisorPid: 99999 });
  });

  it('skips the kill step and only spawns when nothing is listening on the port', () => {
    cp.execFileSync.mockImplementation((cmd) => {
      if (cmd === 'netstat') return '  TCP  0.0.0.0:9999  0.0.0.0:0  LISTENING  1\n';
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = restartModule('heidi-mobile-chat', { log: () => {} });

    expect(cp.execFileSync).not.toHaveBeenCalledWith('taskkill', expect.anything());
    expect(cp.spawn).toHaveBeenCalled();
    expect(result.stoppedPid).toBeNull();
  });

  it('propagates a clear error for an unknown module id without touching any process', () => {
    expect(() => restartModule('not-a-real-module', { log: () => {} })).toThrow(/Unknown module id/);
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});
