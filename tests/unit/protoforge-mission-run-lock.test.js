'use strict';

/**
 * MissionRunLock -- the singleton primitive scripts/protoforge-opportunity-
 * scheduler.js uses to guarantee at most one active
 * protoforge.daily_opportunity_scan run at a time. Uses real temp files
 * (no mocking needed -- this is pure fs + PID-liveness logic, and
 * boot-instance-lease.js's own isPidAlive is exercised for real against
 * this process's own PID and a definitely-dead one).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MissionRunLock } = require('../../scripts/mission-run-lock');

let lockPath;
beforeEach(() => {
  lockPath = path.join(os.tmpdir(), `protoforge-scout-test-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`);
});
afterEach(() => {
  try { fs.unlinkSync(lockPath); } catch (_) { /* fine */ }
});

describe('MissionRunLock: normal acquire/release', () => {
  it('acquires a fresh (nonexistent) lock', () => {
    const lock = new MissionRunLock(lockPath);
    const claim = lock.acquire();
    expect(claim.acquired).toBe(true);
    expect(claim.reclaimedStale).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('writes this process\'s own PID into the lock file', () => {
    const lock = new MissionRunLock(lockPath);
    lock.acquire();
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(record.pid).toBe(process.pid);
    expect(record.startedAt).toBeDefined();
  });

  it('release() removes the lock file when this process owns it', () => {
    const lock = new MissionRunLock(lockPath);
    lock.acquire();
    expect(lock.release()).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('release() is a safe no-op when there is nothing to release', () => {
    const lock = new MissionRunLock(lockPath);
    expect(lock.release()).toBe(false);
  });
});

describe('MissionRunLock: overlap rejection (Test B)', () => {
  it('refuses a second acquire while the first is still active (same live PID)', () => {
    const first = new MissionRunLock(lockPath);
    const second = new MissionRunLock(lockPath);
    const claim1 = first.acquire();
    const claim2 = second.acquire();
    expect(claim1.acquired).toBe(true);
    expect(claim2.acquired).toBe(false);
    expect(claim2.reason).toBe('active');
    expect(claim2.holder.pid).toBe(process.pid);
  });

  it('isActive() reports true while a legitimate lock is held', () => {
    const lock = new MissionRunLock(lockPath);
    lock.acquire();
    expect(lock.isActive()).toBe(true);
  });
});

describe('MissionRunLock: stale lock recovery (Test F)', () => {
  it('reclaims a lock whose PID is dead', () => {
    // A PID essentially guaranteed not to exist on this machine.
    const deadPid = 999999;
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }));
    const lock = new MissionRunLock(lockPath);
    expect(lock.isActive()).toBe(false);
    const claim = lock.acquire();
    expect(claim.acquired).toBe(true);
    expect(claim.reclaimedStale).toBe(true);
  });

  it('reclaims a lock that is too old even if its PID happens to be alive (Windows PID-reuse safety net)', () => {
    // Use this test process's OWN pid (definitely alive) but an ancient timestamp.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    const lock = new MissionRunLock(lockPath, 10 * 60 * 1000); // 10 min staleness window
    expect(lock.isActive()).toBe(false);
    const claim = lock.acquire();
    expect(claim.acquired).toBe(true);
    expect(claim.reclaimedStale).toBe(true);
  });

  it('does NOT reclaim a lock that is both alive and within the staleness window', () => {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const lock = new MissionRunLock(lockPath, 10 * 60 * 1000);
    expect(lock.isActive()).toBe(true);
    expect(lock.acquire().acquired).toBe(false);
  });

  it('a stale reclaim never permanently locks the mission out (Test F\'s actual requirement)', () => {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));
    const attempt1 = new MissionRunLock(lockPath);
    expect(attempt1.acquire().acquired).toBe(true);
    attempt1.release();
    const attempt2 = new MissionRunLock(lockPath);
    expect(attempt2.acquire().acquired).toBe(true); // proves the mission can run again normally afterward
  });
});

describe('MissionRunLock: ownership-respecting release', () => {
  it('does not release a lock now owned by a different (newer) holder', () => {
    // Simulate: this process's lock went stale and was reclaimed by another
    // process (different pid) before this process got around to calling release().
    const lock = new MissionRunLock(lockPath);
    lock.acquire();
    // A different process claims the (by-then-stale) lock.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid + 1, startedAt: new Date().toISOString() }));
    const released = lock.release();
    expect(released).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true); // the newer holder's lock survives
  });
});
