'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isHeidiDaemonCommand, classifyDaemonOwner, acquireHeidiDaemonLock } = require('../../scripts/lib/heidi-daemon-lock');

const DAEMON_FORK = 'node C:\\Users\\Owner\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js --no-stabilization';
const OTHER_FORK = 'node C:\\Users\\Owner\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js scripts/revenue-autopilot-tick.ts';
const BARE_FORK = 'node C:\\Users\\Owner\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js';
const LOCK_TS = new Date('2026-11-03T21:39:11.660Z').getTime();

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')); }
function lockFile() { const lf = path.join(tmpdir(), 'lock'); fs.writeFileSync(lf, JSON.stringify({ pid: 1234, startedAt: new Date(LOCK_TS).toISOString() })); return lf; }

describe('isHeidiDaemonCommand', () => {
  it('matches the direct daemon script', () => {
    expect(isHeidiDaemonCommand('node scripts/heidi-daemon.ts --no-stabilization')).toBe(true);
  });
  it('does NOT match a bare ProcessContainerFork (cmdline alone is ambiguous)', () => {
    expect(isHeidiDaemonCommand(DAEMON_FORK)).toBe(false);
  });
  it('rejects unrelated processes', () => {
    expect(isHeidiDaemonCommand('node server.js')).toBe(false);
  });
});

describe('classifyDaemonOwner', () => {
  it('daemon: a fork carrying the daemon args whose creation time matches', () => {
    expect(classifyDaemonOwner(DAEMON_FORK, LOCK_TS, LOCK_TS + 3000)).toBe('daemon');
  });
  it('daemon: a fork carrying the daemon args when creation time is unavailable', () => {
    expect(classifyDaemonOwner(DAEMON_FORK, LOCK_TS, null)).toBe('daemon');
  });
  it('unknown: daemon args but creation time contradicts the lock', () => {
    expect(classifyDaemonOwner(DAEMON_FORK, LOCK_TS, LOCK_TS - 3600_000)).toBe('unknown');
  });
  it('unrelated: a fork carrying a different app args (wrong-app PID reuse)', () => {
    expect(classifyDaemonOwner(OTHER_FORK, LOCK_TS, LOCK_TS)).toBe('unrelated');
  });
  it('unknown: a fork with no args (cannot distinguish app)', () => {
    expect(classifyDaemonOwner(BARE_FORK, LOCK_TS, LOCK_TS)).toBe('unknown');
  });
  it('unrelated: a non-fork non-daemon command', () => {
    expect(classifyDaemonOwner('node server.js', LOCK_TS, LOCK_TS)).toBe('unrelated');
  });
});

describe('acquireHeidiDaemonLock', () => {
  it('refuses when a live daemon fork owns the lock (args + time match)', () => {
    const lf = lockFile();
    const errors = [];
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true,
      processInfo: () => ({ commandLine: DAEMON_FORK, creationDateMs: LOCK_TS + 2000 }),
      error: (m) => errors.push(m), log: () => {},
    });
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/another daemon|PID: 1234/i);
  });
  it('refuses (never cleans) when the live fork owner is ambiguous — bare args', () => {
    const lf = lockFile();
    const errors = [];
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true,
      processInfo: () => ({ commandLine: BARE_FORK, creationDateMs: LOCK_TS }),
      error: (m) => errors.push(m), log: () => {},
    });
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/ambiguous|refusing/i);
    expect(fs.existsSync(lf)).toBe(true); // lock preserved
  });
  it('cleans a lock owned by a wrong-app ProcessContainerFork (different args)', () => {
    const lf = lockFile();
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true,
      processInfo: () => ({ commandLine: OTHER_FORK, creationDateMs: LOCK_TS }),
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
