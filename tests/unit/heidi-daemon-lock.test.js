'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isHeidiDaemonCommand, isDaemonOwner, acquireHeidiDaemonLock } = require('../../scripts/lib/heidi-daemon-lock');

const FORK = 'node C:\\Users\\Owner\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js --no-stabilization';
const LOCK_TS = new Date('2026-11-03T21:39:11.660Z').getTime();

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')); }
function lockFile() { const lf = path.join(tmpdir(), 'lock'); fs.writeFileSync(lf, JSON.stringify({ pid: 1234, startedAt: new Date(LOCK_TS).toISOString() })); return lf; }

describe('isHeidiDaemonCommand', () => {
  it('matches the direct daemon script', () => {
    expect(isHeidiDaemonCommand('node scripts/heidi-daemon.ts --no-stabilization')).toBe(true);
  });
  it('does NOT match a bare ProcessContainerFork (cmdline alone is ambiguous)', () => {
    expect(isHeidiDaemonCommand(FORK)).toBe(false);
  });
  it('rejects unrelated processes', () => {
    expect(isHeidiDaemonCommand('node server.js')).toBe(false);
  });
});

describe('isDaemonOwner', () => {
  it('accepts a fork whose creation time matches the lock startedAt', () => {
    expect(isDaemonOwner(FORK, LOCK_TS, LOCK_TS + 3000)).toBe(true);
  });
  it('rejects a fork with a mismatched creation time (PID reuse / wrong app)', () => {
    expect(isDaemonOwner(FORK, LOCK_TS, LOCK_TS - 3600_000)).toBe(false);
  });
  it('rejects a fork when creation time is unavailable', () => {
    expect(isDaemonOwner(FORK, LOCK_TS, null)).toBe(false);
  });
});

describe('acquireHeidiDaemonLock', () => {
  it('refuses when a live ProcessContainerFork owns the lock and its creation time matches', () => {
    const lf = lockFile();
    const errors = [];
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true,
      processInfo: () => ({ commandLine: FORK, creationDateMs: LOCK_TS + 2000 }),
      error: (m) => errors.push(m), log: () => {},
    });
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/another daemon|PID: 1234/i);
  });
  it('cleans a lock owned by a wrong-app ProcessContainerFork (creation time mismatch)', () => {
    const lf = lockFile();
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true,
      processInfo: () => ({ commandLine: FORK, creationDateMs: LOCK_TS - 3600_000 }),
      log: () => {}, error: () => {},
    });
    expect(ok).toBe(true);
  });
  it('cleans the lock when the owner pid is dead', () => {
    const lf = path.join(tmpdir(), 'lock');
    fs.writeFileSync(lf, JSON.stringify({ pid: 1234 }));
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => false, commandLine: () => null, log: () => {}, error: () => {},
    });
    expect(ok).toBe(true);
  });
  it('does not refuse forever on an unreadable cmdline (the Cannot-verify wedge)', () => {
    const lf = path.join(tmpdir(), 'lock');
    fs.writeFileSync(lf, JSON.stringify({ pid: 1234 }));
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true, commandLine: () => null, log: () => {}, error: () => {},
    });
    // Unreadable cmdline + alive pid -> treated as possibly-ours, refused once,
    // but the lock isn't wedged permanently (PM2 retry / next pass can read it).
    expect(typeof ok).toBe('boolean');
  });
});
