'use strict';
/**
 * Recovery lease -- closes the RecoveryEngine orphan-supervision gap found
 * 2026-09-12.
 * ---------------------------------------------------------------------------
 * The gap: RecoveryEngine.restartProcess() spawns a replacement process
 * `detached: true` + `unref()`'d so it survives the short-lived
 * `hydi-recover.js` CLI exiting -- necessary, since otherwise a successful
 * recovery would die the moment the CLI that triggered it returned. But once
 * that CLI process exits, the spawned child's OS parent is gone, and nothing
 * else has ever recorded that this specific PID is a legitimate,
 * intentional recovery rather than an unidentified stray. scripts/boot-agent.js's
 * classifyOccupant() (see its own header) would correctly-but-unhelpfully
 * report it as `ownership: 'unsupervised'` -- true in the narrow sense that
 * ancestry doesn't trace to the current boot-agent, but wrong in the sense
 * that leaves the operator with no way to tell "an unknown process is
 * squatting on this port" apart from "RecoveryEngine did exactly what it was
 * asked to do ten minutes ago." This file gives that second case a durable,
 * discoverable identity so classifyOccupant can report `'recovered'`
 * instead of conflating the two.
 *
 * What this does NOT solve: it is not possible to retroactively make an
 * already-spawned process a real child of a different, already-running
 * process (no such re-parenting exists in Node or, portably, in the OS) --
 * so a RecoveryEngine-recovered process still cannot be watched for its own
 * `exit` event by boot-agent the way a boot-agent-spawned child can. Full
 * continuous re-supervision would require routing the actual spawn through
 * boot-agent itself (a live IPC channel into the running boot-agent
 * process) -- a materially larger change than closing this classification
 * gap, and out of scope here. What this DOES give you: an honest label
 * ('recovered', not 'unsupervised') and a durable audit trail of who
 * spawned it, when, and why -- both of which were previously nonexistent
 * outside a single OperationalIntelligence in-memory event that died with
 * the CLI process that created it.
 */

const fs = require('fs');
const path = require('path');

// RECOVERY_LEASE_DIR is a test seam, mirroring HYDI_BOOT_LEASE_PATH /
// PROTOFORGE_SCOUT_LOCK_PATH's role elsewhere in this project. Production
// never sets it.
const LEASE_DIR = process.env.RECOVERY_LEASE_DIR
  ? path.resolve(process.env.RECOVERY_LEASE_DIR)
  : path.resolve(__dirname, '..', '.recovery-leases');

// How long a lease is considered a "recent, explicable" recovery for
// classification purposes. This is NOT a liveness check (classifyOccupant
// already has isPidAlive/isDescendantOf for that) -- it only bounds how
// long a single recovery event stays labeled 'recovered' before reverting
// to being judged purely on ancestry again, so a lease from weeks ago can't
// paper over a since-unrelated process that happens to reuse the same PID.
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000; // 24h

function leasePath(component) {
  return path.join(LEASE_DIR, `${component}.json`);
}

/**
 * Record that RecoveryEngine (or another recovery actor) spawned a
 * replacement process for `component`. Call this once, right after the
 * spawn succeeds -- see lib/operational/RecoveryEngine.ts's restartProcess().
 */
function record(component, info) {
  fs.mkdirSync(LEASE_DIR, { recursive: true });
  const entry = {
    component,
    pid: info.pid,
    command: info.command || null,
    args: info.args || [],
    recoveredAt: new Date().toISOString(),
    recoveredBy: info.recoveredBy || 'RecoveryEngine',
    cause: info.cause || null,
  };
  const target = leasePath(component);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  return entry;
}

function read(component) {
  try {
    return JSON.parse(fs.readFileSync(leasePath(component), 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * A non-stale lease for `component`, or null. Deliberately does NOT compare
 * PIDs itself: the PID recorded here is whatever `child.pid` was for
 * `spawn(command, args, {shell:true})`, which on Windows is the intermediate
 * cmd.exe wrapper, not the final process bound to the port (the same
 * one-hop-removed shape every other spawn in this codebase produces -- see
 * boot-agent.js's own spawnProcess()). Matching the actual port occupant
 * against this lease is therefore an ANCESTRY check (is the occupant a
 * descendant of lease.pid), not equality -- boot-agent.js's classifyOccupant
 * already has isDescendantOf for exactly that and is the right place to
 * apply it, not this file (which has no process-inspection dependency by
 * design).
 */
function getValidLease(component, staleMs = DEFAULT_STALE_MS) {
  const lease = read(component);
  if (!lease) return null;
  const ageMs = Date.now() - new Date(lease.recoveredAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > staleMs) return null;
  return lease;
}

function clear(component) {
  try { fs.unlinkSync(leasePath(component)); } catch (_) { /* already gone */ }
}

module.exports = { record, read, getValidLease, clear, LEASE_DIR, DEFAULT_STALE_MS };
