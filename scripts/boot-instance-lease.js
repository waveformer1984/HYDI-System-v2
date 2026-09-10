'use strict';
/**
 * Boot Instance Lease — single-instance contract for the HYDI boot runtime.
 * ---------------------------------------------------------------------------
 * The problem this solves (observed 2026-09-10, twice):
 *
 *   pm2 restart hydi-boot
 *     → PM2 stops the old fork (graceful IPC shutdown, ~1s of
 *       "failed to kill - retrying in 100ms" while it also treekills)
 *     → PM2 spawns the replacement and marks it online
 *     → the OLD fork's exit event lands a moment later and PM2 attributes it to
 *       the replacement:  "App [hydi-boot:4] exited with code [0]"
 *     → autorestart + restart_delay(5000) spawns a SECOND fork 5s later
 *     → the first replacement is never killed. Two boot runtimes are now live,
 *       each with its own hydi-orchestrator core loop and job-executor-poller.
 *
 * Killing the orphan does not converge: PM2 sees an exit and spawns another.
 * The duplication just moves. So the invariant cannot be enforced by killing
 * processes from the outside — the runtime has to enforce it itself.
 *
 * Contract
 * --------
 * A single lease file names exactly one live boot runtime. Newest claim wins:
 *
 *   - On startup a boot runtime writes its own identity into the lease.
 *   - Every running boot runtime polls the lease. If it no longer names itself,
 *     it has been superseded and gracefully shuts down its modules and exits.
 *
 * Newest-wins (rather than "second instance refuses to start") is deliberate:
 * PM2 will keep respawning a replacement that exits, so a newcomer that backs
 * off would just be restarted forever until max_restarts trips and PM2 gives up
 * supervising entirely. Letting the newcomer take over and the incumbent stand
 * down converges in one poll interval with no process killing at all.
 *
 * Identity is a random bootId, never a PID. Windows reuses PIDs aggressively —
 * during the incident an unrelated Intel service (ICPS.exe, started 84 minutes
 * earlier) appeared as a child of a poller process purely through PID reuse. A
 * PID is not a durable identity here; a bootId is.
 *
 * The superseded instance exits with SUPERSEDED_EXIT_CODE, which
 * ecosystem.config.js lists in hydi-boot's `stop_exit_codes` so PM2 does not
 * treat an orderly stand-down as a crash worth restarting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Exit code used when a boot runtime stands down because a newer one claimed
 * the lease. Must stay in sync with ecosystem.config.js -> hydi-boot ->
 * stop_exit_codes.
 */
const SUPERSEDED_EXIT_CODE = 75;

const DEFAULT_LOCK_PATH = path.resolve(__dirname, '..', '.hydi-boot.lock');

class BootInstanceLease {
  /**
   * @param {object}   [opts]
   * @param {string}   [opts.lockPath] lease file location
   * @param {function} [opts.now]      clock injection for tests
   * @param {function} [opts.newId]    id generator injection for tests
   */
  constructor(opts = {}) {
    this.lockPath = opts.lockPath || DEFAULT_LOCK_PATH;
    this.now = opts.now || (() => new Date());
    this.newId = opts.newId || (() => crypto.randomBytes(12).toString('hex'));
    this.bootId = null;
  }

  /**
   * Read the current lease, or null when absent/unreadable/corrupt.
   * A corrupt lease is treated as absent rather than fatal — a boot runtime
   * must never be unable to start because of a malformed lock file.
   */
  read() {
    try {
      const raw = fs.readFileSync(this.lockPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.bootId !== 'string') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  /**
   * Claim the lease for this process. Always succeeds (newest wins).
   *
   * @returns {{bootId: string, supersededOwner: object|null}}
   */
  claim() {
    const previous = this.read();
    this.bootId = this.newId();

    const record = {
      bootId: this.bootId,
      pid: process.pid,
      startedAt: this.now().toISOString(),
      // Recorded for operators only. Never used as identity — see the PID-reuse
      // note in this file's header.
      ppid: typeof process.ppid === 'number' ? process.ppid : null,
    };

    this._writeAtomic(record);

    const supersededOwner =
      previous && previous.bootId !== this.bootId ? previous : null;
    return { bootId: this.bootId, supersededOwner };
  }

  /**
   * True while the lease still names this instance.
   * False once a newer boot runtime has claimed it — i.e. we are superseded and
   * must stand down.
   *
   * A missing lease also returns false: something removed it, and continuing to
   * run while unable to prove ownership would defeat the whole contract.
   */
  isStillOwner() {
    if (!this.bootId) return false;
    const current = this.read();
    if (!current) return false;
    return current.bootId === this.bootId;
  }

  /**
   * Release the lease, but only if we still own it. Releasing unconditionally
   * would let a superseded instance delete its successor's lease on the way out.
   */
  release() {
    if (!this.isStillOwner()) return false;
    try {
      fs.unlinkSync(this.lockPath);
      return true;
    } catch (_) {
      return false;
    }
  }

  _writeAtomic(record) {
    const tmp = `${this.lockPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
    fs.renameSync(tmp, this.lockPath);
  }
}

module.exports = {
  BootInstanceLease,
  SUPERSEDED_EXIT_CODE,
  DEFAULT_LOCK_PATH,
};
