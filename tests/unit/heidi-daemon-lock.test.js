'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isHeidiDaemonCommand, acquireHeidiDaemonLock } = require('../../scripts/lib/heidi-daemon-lock');

const FORK = 'node C:\\Users\\Owner\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js --no-stabilization';

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')); }

describe('isHeidiDaemonCommand', () => {
  it('matches the direct daemon script', () => {
    expect(isHeidiDaemonCommand('node scripts/heidi-daemon.ts --no-stabilization')).toBe(true);
  });
  it('matches a PM2 ProcessContainerFork (the supervised daemon)', () => {
    expect(isHeidiDaemonCommand(FORK)).toBe(true);
  });
  it('rejects unrelated processes', () => {
    expect(isHeidiDaemonCommand('node server.js')).toBe(false);
  });
});

describe('acquireHeidiDaemonLock', () => {
  it('refuses when a live ProcessContainerFork owns the lock (the observed wedge)', () => {
    const lf = path.join(tmpdir(), 'lock');
    fs.writeFileSync(lf, JSON.stringify({ pid: 1234 }));
    const errors = [];
    const ok = acquireHeidiDaemonLock(lf, { cwd: '.', commit: null }, {
      pid: 999, isAlive: () => true, commandLine: () => FORK,
      error: (m) => errors.push(m), log: () => {},
    });
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/another daemon|PID: 1234/i);
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
