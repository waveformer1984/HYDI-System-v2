'use strict';
const cp = require('child_process');

jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return { ...real, execFileSync: jest.fn(), spawn: jest.fn(() => ({ unref: () => {}, pid: 4242 })) };
});

const { restartModule } = require('../../scripts/restart-module');

describe('restart-module pid guard', () => {
  beforeEach(() => { cp.execFileSync.mockReset(); cp.spawn.mockClear(); });

  it('never taskkills pid 0 — a kernel/reserved socket row yields no valid pid', () => {
    cp.execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'netstat') return '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       0\n';
      return '';
    });
    const r = restartModule('heidi-web', { log: () => {} });
    expect(r.stoppedPid).toBeNull();
    const kills = cp.execFileSync.mock.calls.filter((c) => c[0] === 'taskkill');
    expect(kills).toHaveLength(0); // no taskkill on a non-pid
  });
  it('stops a real pid normally', () => {
    cp.execFileSync.mockImplementation((cmd) => {
      if (cmd === 'netstat') return '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       12345\n';
      return '';
    });
    const r = restartModule('heidi-web', { log: () => {} });
    expect(r.stoppedPid).toBe('12345');
    const kills = cp.execFileSync.mock.calls.filter((c) => c[0] === 'taskkill');
    expect(kills[0][1]).toEqual(['/PID', '12345', '/F']);
  });
});
