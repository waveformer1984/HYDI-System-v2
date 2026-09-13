'use strict';

/**
 * Unit tests for scripts/process-identity.js — read-only PID/ancestry
 * inspection. `child_process` is fully mocked throughout: these tests never
 * shell out to a real `netstat`/PowerShell/`lsof`/`ps`, and never touch a
 * real process.
 */

jest.mock('child_process');
const cp = require('child_process');
const { findPidsOnPort, getProcessInfo, isDescendantOf } = require('../../scripts/process-identity');

describe('process-identity: findPidsOnPort', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    jest.clearAllMocks();
  });

  it('parses LISTENING PIDs from a Windows netstat -ano line', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockReturnValue(
      '  TCP    0.0.0.0:3005           0.0.0.0:0              LISTENING       25324\n' +
      '  TCP    [::]:3005              [::]:0                 LISTENING       25324\n' +
      '  TCP    127.0.0.1:3005         127.0.0.1:51000        TIME_WAIT       0\n'
    );
    expect(findPidsOnPort(3005)).toEqual(['25324']);
  });

  it('dedupes a dual-stack (IPv4+IPv6) process listed twice', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockReturnValue(
      '  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   111\n' +
      '  TCP    [::]:3000      [::]:0      LISTENING   111\n'
    );
    expect(findPidsOnPort(3000)).toEqual(['111']);
  });

  it('returns empty when nothing listens on the port', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockReturnValue('  TCP  0.0.0.0:9999  0.0.0.0:0  LISTENING  1\n');
    expect(findPidsOnPort(3005)).toEqual([]);
  });

  it('never throws when the lookup command itself fails', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockImplementation(() => { throw new Error('netstat unavailable'); });
    expect(findPidsOnPort(3005)).toEqual([]);
  });

  it('parses PIDs from lsof on POSIX platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    cp.execSync.mockReturnValue('25324\n');
    expect(findPidsOnPort(3005)).toEqual(['25324']);
    expect(cp.execSync).toHaveBeenCalledWith('lsof -ti :3005 2>/dev/null', expect.any(Object));
  });
});

describe('process-identity: getProcessInfo', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    jest.clearAllMocks();
  });

  it('reads name, cmdline and ppid from a single Win32_Process query', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockReturnValue(JSON.stringify({
      ProcessName: 'node.exe',
      CommandLine: 'node src/server.js',
      ParentProcessId: 20592,
    }));

    const info = getProcessInfo('25324');
    expect(info).toEqual({ pid: '25324', name: 'node.exe', cmdline: 'node src/server.js', ppid: '20592' });
    // One call, not the two separate Get-Process + Get-CimInstance calls an
    // earlier duplicate of this logic used.
    expect(cp.execSync).toHaveBeenCalledTimes(1);
  });

  it('reports ppid: null when a process has already exited (empty query result)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockReturnValue('');
    expect(getProcessInfo('99999')).toEqual({ pid: '99999', name: null, cmdline: null, ppid: null });
  });

  it('never throws when the query itself fails', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.execSync.mockImplementation(() => { throw new Error('access denied'); });
    expect(getProcessInfo('1')).toEqual({ pid: '1', name: null, cmdline: null, ppid: null });
  });

  it('parses name/ppid/args from ps on POSIX platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    cp.execSync.mockReturnValue('node 20592 node src/server.js');
    expect(getProcessInfo('25324')).toEqual({
      pid: '25324', name: 'node', cmdline: 'node src/server.js', ppid: '20592',
    });
  });
});

describe('process-identity: isDescendantOf', () => {
  const realPlatform = process.platform;
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    jest.clearAllMocks();
  });

  /** Wires execSync so getProcessInfo(pid) returns ppidByPid[pid], keyed by the PID embedded in the PowerShell filter. */
  function mockChain(ppidByPid) {
    cp.execSync.mockImplementation((cmd) => {
      const m = /ProcessId=(\d+)/.exec(cmd);
      const pid = m && m[1];
      const ppid = pid != null ? ppidByPid[pid] : undefined;
      if (ppid === undefined) return ''; // simulate "process not found" for unmapped PIDs
      return JSON.stringify({ ProcessName: 'node.exe', CommandLine: 'node x.js', ParentProcessId: Number(ppid) });
    });
  }

  it('is trivially true when the PID equals the ancestor', () => {
    expect(isDescendantOf('20592', '20592')).toBe(true);
    expect(cp.execSync).not.toHaveBeenCalled(); // no lookup needed
  });

  it('confirms a direct child (one hop)', () => {
    mockChain({ 27608: 20592 }); // heidi-web's shell wrapper, one hop from boot-agent
    expect(isDescendantOf('27608', '20592')).toBe(true);
  });

  it('confirms a grandchild through a shell wrapper (two hops)', () => {
    // e.g. boot-agent (20592) -> cmd.exe (27608) -> next start (11996)
    mockChain({ 11996: 27608, 27608: 20592 });
    expect(isDescendantOf('11996', '20592')).toBe(true);
  });

  it('returns false when the chain reaches a different root entirely', () => {
    // The actual incident: 25324 -> 17060 (cmd.exe) -> 24572 (jest, unrelated to boot-agent)
    mockChain({ 25324: 17060, 17060: 24572, 24572: 1 });
    expect(isDescendantOf('25324', '20592')).toBe(false);
  });

  it('returns false (not true) when a link in the chain cannot be resolved', () => {
    // 17060's parent (24572) has already exited by the time we look it up.
    mockChain({ 25324: 17060 }); // 17060 -> unmapped -> getProcessInfo returns ppid:null
    expect(isDescendantOf('25324', '20592')).toBe(false);
  });

  it('does not loop forever on a cycle', () => {
    mockChain({ 100: 200, 200: 100 }); // 100 -> 200 -> 100 -> ... would spin without a guard
    expect(isDescendantOf('100', '999')).toBe(false);
  });
});
