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
  let db;
  try { db = JSON.parse(fs.readFileSync(storePath(), 'utf8')); }
  catch { db = { version: 2, actions: [] }; }
  if (!Array.isArray(db.actions)) db.actions = [];
  if (db.version !== 2) {
    db.actions = db.actions.map(migrateAction);
    db.version = 2;
    save(db);
  }
  return db;
}

function save(db) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
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

module.exports = { storePath, load, save, STATUSES };
