'use strict';
/**
 * Generic "at most one active run" lock for HYDI mission schedulers.
 * ---------------------------------------------------------------------------
 * Mirrors scripts/boot-instance-lease.js's proven design (atomic tmp+rename
 * write, PID-liveness check, staleness beats a false "alive" from Windows
 * PID reuse) but scoped to a single execution rather than a long-lived
 * supervisor identity: acquire before running, release when done, and a
 * lock that's too old to be real is reclaimable regardless of what
 * `isPidAlive` says about the PID it names.
 *
 * Why this exists: scripts/protoforge-opportunity-scheduler.js spawns its
 * mission child WITHOUT `detached: true` (see that file's own comment on
 * why). On this OS, a plain spawn()'d child is not guaranteed to die with
 * its parent -- exactly the class of orphan this session's boot-ownership
 * investigation found for protoforge-core (scripts/boot-agent.js's own
 * shutdown() has to `taskkill /T /F` for the same reason). If a scheduler
 * restart (PM2 crash-restart, or a manual `--once` run overlapping the
 * continuous scheduler) raced with an in-flight mission child, nothing
 * previously stopped a second cycle from starting concurrently. This lock
 * makes that impossible without requiring the spawn itself to change.
 *
 * Deliberately NOT reusing BootInstanceLease directly: that class's
 * "newest claim always wins, older instance stands itself down" semantics
 * are correct for one continuously-supervising runtime, but wrong here --
 * a second scan racing in should be REJECTED, not allowed to evict the
 * first one mid-run and start duplicate network calls.
 */

const fs = require('fs');
const { isPidAlive } = require('./boot-instance-lease');

class MissionRunLock {
  /**
   * @param {string} lockPath
   * @param {number} [staleMs=600000]  A lock older than this is reclaimable
   *   even if `isPidAlive` reports its PID as alive (Windows recycles PIDs
   *   aggressively -- see boot-instance-lease.js's own note on this). Default
   *   10 minutes is generous headroom over the mission's default 60s
   *   RUN_TIMEOUT_MS while still being far short of the 24h scan interval,
   *   so a truly stuck run can't block more than one day's cycle for long.
   */
  constructor(lockPath, staleMs = 10 * 60 * 1000) {
    this.lockPath = lockPath;
    this.staleMs = staleMs;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  /** Is the lock (if any) held by a run that is still legitimately in progress? */
  isActive() {
    const current = this.read();
    if (!current) return false;
    const ageMs = Date.now() - new Date(current.startedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > this.staleMs) return false; // stale by age -- reclaimable regardless of PID
    return isPidAlive(current.pid);
  }

  /**
   * @returns {{acquired: boolean, reason?: string, holder?: object, reclaimedStale?: boolean}}
   */
  acquire(meta = {}) {
    const previous = this.read();
    if (this.isActive()) {
      return { acquired: false, reason: 'active', holder: previous };
    }
    const record = { pid: process.pid, startedAt: new Date().toISOString(), ...meta };
    const tmp = `${this.lockPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
    fs.renameSync(tmp, this.lockPath);
    return { acquired: true, reclaimedStale: Boolean(previous) };
  }

  /**
   * Release only if this process still owns the lock -- mirrors
   * BootInstanceLease.release()'s rule that a superseded/stale holder must
   * never delete a lock a newer, legitimate holder has since claimed.
   */
  release() {
    const current = this.read();
    if (current && current.pid === process.pid) {
      try { fs.unlinkSync(this.lockPath); } catch (_) { /* already gone */ }
      return true;
    }
    return false;
  }
}

module.exports = { MissionRunLock };
