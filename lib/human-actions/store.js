'use strict';

/**
 * Durable JSON store for Human Actions — tasks HYDI assigns to a human
 * operator because only a human can perform them (credentials, funding,
 * approvals outside the system, physical steps). A record is durable
 * evidence: instructions given, verification spec, derived results —
 * never secret values.
 *
 * Schema v2 (canonical contract):
 *   id, blockerKey, type, title, description, instructions[],
 *   status: OPEN | CLAIMED | VERIFYING | BLOCKED | RESOLVED | REJECTED
 *           | EXPIRED | CANCELLED,
 *   priority, createdAt, updatedAt, claimedAt, completedAt, expiresAt,
 *   owner, source, sourceMissionId, sourceGoalId, sourceAgentId,
 *   verifier: { name, spec },
 *   verification: { verificationId, verifier, checkedAt, passed,
 *                   checks[], evidence, safeSummary, failureReason } | null,
 *   evidence[], attempts, lastError, resumePolicy,
 *   transitions[] — append-only audit trail.
 *
 * v1 records (snake_case fields, lowercase statuses) are migrated on load.
 */

const fs = require('fs');
const path = require('path');
const { normalizeBoundary } = require('./boundary');

const STATUSES = ['OPEN', 'CLAIMED', 'VERIFYING', 'BLOCKED', 'RESOLVED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

const STATUS_MIGRATION = { open: 'OPEN', claimed: 'CLAIMED', verifying: 'VERIFYING', blocked: 'BLOCKED', resolved: 'RESOLVED', rejected: 'REJECTED', expired: 'EXPIRED', cancelled: 'CANCELLED' };

function storePath() {
  if (process.env.HYDI_HUMAN_ACTIONS_FILE) return process.env.HYDI_HUMAN_ACTIONS_FILE;
  const fromModule = path.join(__dirname, '..', '..', 'data', 'human-actions.json');
  // Bundled contexts (Next/webpack) relocate __dirname under .next/server —
  // fall back to the process cwd (repo root in every runtime we support).
  if (fs.existsSync(path.dirname(fromModule))) return fromModule;
  return path.join(process.cwd(), 'data', 'human-actions.json');
}

function migrateAction(a) {
  if (a.schema === 2) return a;
  const status = STATUS_MIGRATION[String(a.status || '').toLowerCase()] || 'OPEN';
  return {
    id: a.id,
    blockerKey: a.blockerKey ?? a.blocker_key ?? null,
    type: a.type ?? a.kind ?? 'general',
    title: a.title,
    description: a.description ?? null,
    instructions: a.instructions || [],
    status,
    priority: a.priority || 'normal',
    createdAt: a.createdAt ?? a.created_at ?? new Date().toISOString(),
    updatedAt: a.updatedAt ?? a.created_at ?? new Date().toISOString(),
    claimedAt: a.claimedAt ?? a.claimed_at ?? null,
    completedAt: a.completedAt ?? a.resolved_at ?? null,
    expiresAt: a.expiresAt ?? null,
    owner: a.owner ?? 'operator',
    source: a.source ?? 'detector',
    sourceMissionId: a.sourceMissionId ?? a.context?.mission ?? null,
    sourceGoalId: a.sourceGoalId ?? null,
    sourceAgentId: a.sourceAgentId ?? null,
    verifier: a.verifier ?? { name: a.verification?.verifier || 'manual', spec: a.verification?.spec || {} },
    verification: a.verification && a.verification.checkedAt ? a.verification
      : (a.verify_result ? {
        verificationId: null,
        verifier: a.verification?.verifier || a.verifier?.name || 'manual',
        checkedAt: a.verify_result.checked_at ?? null,
        passed: !!a.verify_result.ok,
        checks: [],
        evidence: a.verify_result.evidence ?? null,
        safeSummary: a.verify_result.ok ? 'v1 check passed' : (a.verify_result.reason || 'v1 check failed'),
        failureReason: a.verify_result.ok ? null : (a.verify_result.reason || null),
      } : null),
    resolution: a.resolution ?? null,
    resolver: a.resolver ?? null,
    // Boundary contract is additive: v1 records derive the category from
    // their legacy type at migration; v2 records keep whatever they have.
    boundary: a.boundary ?? normalizeBoundary({ type: a.type ?? a.kind, boundary: a.boundary }),
    evidence: a.evidence ?? [],
    attempts: a.attempts ?? 0,
    lastError: a.lastError ?? null,
    resumePolicy: a.resumePolicy ?? 'auto',
    context: a.context ?? null,
    transitions: a.transitions ?? [{
      type: 'CREATED', at: a.created_at ?? new Date().toISOString(),
      actor: a.source ?? 'detector', detail: 'migrated from schema v1',
    }],
    schema: 2,
  };
}

function load() {
  const p = storePath();
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) {
    // Missing store is a fresh start. Any other read failure (permissions,
    // transient lock) must fail closed — an empty db here flows into save()
    // and permanently overwrites the durable record set on disk.
    if (e && e.code === 'ENOENT') return { version: 2, actions: [] };
    throw e;
  }
  let db;
  try { db = JSON.parse(raw); }
  catch (e) {
    // A corrupt/torn store is a hard failure, not a fresh start: returning an
    // empty db here once wiped every durable action record on the next save().
    throw new Error(`human-actions store corrupt at ${p} — refusing to load (durable records preserved on disk for manual repair): ${e instanceof Error ? e.message : 'parse error'}`);
  }
  if (!Array.isArray(db.actions)) db.actions = [];
  if (db.version !== 2) {
    db.actions = db.actions.map(migrateAction);
    db.version = 2;
    save(db);
  }
  return db;
}

/**
 * Scoped cross-process mutex — a lockfile next to the store.
 * The load-modify-save pattern has no other serialization: two writers
 * (daemon + CLI + API) can each read the same snapshot and the second
 * save silently drops the first's records. 'wx' create is atomic across
 * processes on the same filesystem.
 *
 * Bounded: waits up to LOCK_WAIT_MS, then fails the mutation with a
 * clear error — callers (detector sweep, verify retry) are idempotent
 * and retry. A lock older than LOCK_STALE_MS is broken, so a dead
 * holder can never wedge the store permanently.
 */
const LOCK_STALE_MS = 60 * 1000;
const LOCK_WAIT_MS = 2500;
const LOCK_RETRY_MS = 20;

function _spin(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* brief spin */ } }

// In-process registry of locks this process currently holds. A lockfile
// whose pid is ours but which is NOT in this set is a leftover from a
// failed release — safe to break. If it IS in the set, a second acquire
// is real reentrancy (a mutation calling a mutation) and must fail fast.
const _heldLocks = new Set();

function _lockIsStale(lp, mtimeMs) {
  if (Date.now() - mtimeMs > LOCK_STALE_MS) return true;
  // The lockfile carries the holder's pid. If that process is ours, the
  // file can only be a leftover; if the process is dead, same story.
  try {
    const holderPid = parseInt(fs.readFileSync(lp, 'utf8'), 10);
    if (!Number.isNaN(holderPid)) {
      if (holderPid === process.pid && !_heldLocks.has(lp)) return true;
      try { process.kill(holderPid, 0); }
      catch (e) { if (e && e.code === 'ESRCH') return true; }
    }
  } catch { /* unreadable payload — fall back to mtime judgement */ }
  return false;
}

function acquireLock() {
  const lp = storePath() + '.lock';
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (; ;) {
    try {
      const fd = fs.openSync(lp, 'wx');
      try { fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}`); } finally { fs.closeSync(fd); }
      _heldLocks.add(lp);
      return lp;
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        try {
          if (_lockIsStale(lp, fs.statSync(lp).mtimeMs)) { try { fs.unlinkSync(lp); } catch { /* raced */ } continue; }
        } catch { continue; } // holder released between open and stat — retry create
        if (Date.now() > deadline) {
          throw new Error(`human-actions store lock held beyond ${LOCK_WAIT_MS}ms — another writer is active; refusing to risk a lost update`);
        }
        _spin(LOCK_RETRY_MS);
        continue;
      }
      throw e; // real fs error (permissions, missing dir) — fail loud
    }
  }
}

function releaseLock(lp) {
  if (!lp) return;
  _heldLocks.delete(lp);
  // Windows AV/indexers can briefly hold the just-closed lockfile — retry
  // the unlink rather than leaving a file that blocks every later writer.
  for (let i = 0; i < 3; i++) {
    try { fs.unlinkSync(lp); return; }
    catch (e) {
      if (e && e.code === 'ENOENT') return;
      if (i === 2 || (e && e.code !== 'EPERM' && e.code !== 'EBUSY')) return;
      _spin(15);
    }
  }
}

function withStoreLock(fn) {
  const lp = acquireLock();
  try { return fn(); } finally { releaseLock(lp); }
}

function save(db) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Last-known-good backup before every replace — the load-modify-save
  // pattern means one bad load must never be the only copy of history.
  // Backup failure never blocks the save.
  try { if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak'); }
  catch { /* best effort — never fail a save over a backup */ }
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  // Atomic replace — a crash never leaves a torn file. Windows rename can
  // hit a transient EPERM when a reader/AV holds the target; retry then
  // fall back to a direct write rather than losing the record.
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, p); return; }
    catch (e) {
      if (i === 2 || (e && e.code !== 'EPERM' && e.code !== 'EBUSY')) break;
      const t = Date.now() + 15; while (Date.now() < t) { /* brief spin */ }
    }
  }
  fs.writeFileSync(p, JSON.stringify(db, null, 2));
}

module.exports = { storePath, load, save, withStoreLock, acquireLock, releaseLock, STATUSES };
