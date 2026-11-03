'use strict';
const cp = require('child_process');

jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return { ...real, execFileSync: jest.fn(), spawn: jest.fn(() => ({ unref: () => {}, pid: 4242 })) };
});

const { restartModule } = require('../../scripts/restart-module');

const KILL_CMD = process.platform === 'win32' ? 'taskkill' : 'kill';

describe('restart-module pid guard', () => {
  beforeEach(() => { cp.execFileSync.mockReset(); cp.spawn.mockClear(); });

  it('never terminates a non-pid — a "0" listener row yields no valid target', () => {
    cp.execFileSync.mockImplementation((cmd) => {
      if (cmd === 'netstat') return '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       0\n';
      if (cmd === 'lsof') return '0\n';
      return '';
    });
    const r = restartModule('heidi-web', { log: () => {} });
    expect(r.stoppedPid).toBeNull();
    const kills = cp.execFileSync.mock.calls.filter((c) => c[0] === KILL_CMD);
    expect(kills).toHaveLength(0); // no taskkill/kill on a non-pid
  });
  it('rejects malformed pids too', () => {
    for (const bad of ['abc', '12x', '', '  ', '-5']) {
      cp.execFileSync.mockReset();
      cp.execFileSync.mockImplementation((cmd) => {
        if (cmd === 'netstat') return `  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       ${bad}\n`;
        if (cmd === 'lsof') return `${bad}\n`;
        return '';
      });
      const r = restartModule('heidi-web', { log: () => {} });
      expect(r.stoppedPid).toBeNull();
      expect(cp.execFileSync.mock.calls.filter((c) => c[0] === KILL_CMD)).toHaveLength(0);
    }
  });
  it('stops a real pid normally', () => {
    cp.execFileSync.mockImplementation((cmd) => {
      if (cmd === 'netstat') return '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       12345\n';
      if (cmd === 'lsof') return '12345\n';
      return '';
    });
    const r = restartModule('heidi-web', { log: () => {} });
    expect(r.stoppedPid).toBe('12345');
    const kills = cp.execFileSync.mock.calls.filter((c) => c[0] === KILL_CMD);
    expect(kills[0][1]).toEqual(process.platform === 'win32' ? ['/PID', '12345', '/F'] : ['-9', '12345']);
  });
});
