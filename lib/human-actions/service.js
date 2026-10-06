'use strict';

/**
 * HumanActionService — HYDI's mechanism for requesting work only a human
 * can do, and verifying it actually happened.
 *
 * Lifecycle (canonical statuses — store.js STATUSES):
 *
 *   OPEN → CLAIMED → VERIFYING → RESOLVED
 *      ↓       ↓         ↓
 *      └──→ REJECTED / CANCELLED / EXPIRED / BLOCKED (verify keeps
 *          failing — the action is open but the check is honest about it)
 *
 * Invariants:
 *   - RESOLVED requires verifier.passed OR human attestation on a
 *     'manual'-verifier action. "I did it" never resolves by itself.
 *   - blockerKey is the stable identity of the underlying blocker —
 *     requesting the same blocker twice returns the same open action
 *     (dedupe by construction, like tx-hash correlation in the bridge).
 *   - Every mutation appends a transitions[] audit entry: actor, at, type.
 *   - Secrets never enter the record — verifier evidence is derived facts.
 */

const crypto = require('crypto');
const { load, save } = require('./store');
const { runVerifier } = require('./verifiers');

function now() { return new Date().toISOString(); }

const OPEN_STATUSES = new Set(['OPEN', 'CLAIMED', 'VERIFYING', 'BLOCKED']);
const TERMINAL_STATUSES = new Set(['RESOLVED', 'REJECTED', 'EXPIRED', 'CANCELLED']);

class HumanActionService {
  constructor({ emit, verifierDeps } = {}) {
    this.emit = emit || (() => { });
    this.verifierDeps = verifierDeps || null;
  }

  /** Expire due actions lazily — no timer loop needed. */
  _sweepExpiry(db) {
    const t = now();
    let dirty = false;
    for (const a of db.actions) {
      if (a.expiresAt && a.expiresAt <= t && OPEN_STATUSES.has(a.status)) {
        a.status = 'EXPIRED';
        a.updatedAt = t;
        a.transitions.push({ type: 'EXPIRED', at: t, actor: 'system', detail: `expiresAt ${a.expiresAt} reached` });
        dirty = true;
      }
    }
    if (dirty) save(db);
    return db;
  }

  list({ status, sourceGoalId, sourceMissionId, includeTerminal } = {}) {
    const db = this._sweepExpiry(load());
    return db.actions.filter((a) =>
      (!status || a.status === status) &&
      (!sourceGoalId || a.sourceGoalId === sourceGoalId) &&
      (!sourceMissionId || a.sourceMissionId === sourceMissionId) &&
      (includeTerminal || OPEN_STATUSES.has(a.status) || a.status === 'BLOCKED'));
  }

  /** Every action that is still somebody's problem. */
  listOpen() {
    return this.list().filter((a) => OPEN_STATUSES.has(a.status));
  }

  get(id) {
    const db = this._sweepExpiry(load());
    return db.actions.find((a) => a.id === id) || null;
  }

  /** All actions linked to a goal — multi-blocker support. */
  forGoal(goalId) {
    return this.list({ includeTerminal: true }).filter((a) => a.sourceGoalId === goalId);
  }

  /**
   * Request a human action. Idempotent on blockerKey: an existing
   * non-terminal action for the same blocker is returned unchanged.
   * spec: { blockerKey, type, title, description, instructions[],
   *         verifier: {name, spec}, source, sourceMissionId, sourceGoalId,
   *         sourceAgentId, priority, expiresAt, owner, resumePolicy,
   *         context }
   */
  request(spec) {
    if (!spec || !spec.title) throw new Error('human action requires a title');
    const db = load();
    const existing = db.actions.find((a) =>
      a.blockerKey === spec.blockerKey && OPEN_STATUSES.has(a.status));
    if (existing) return { action: existing, created: false };
    const t = now();
    const action = {
      id: 'ha_' + crypto.randomBytes(8).toString('hex'),
      blockerKey: spec.blockerKey || null,
      type: spec.type || spec.kind || 'general',
      title: spec.title,
      description: spec.description || null,
      instructions: spec.instructions || [],
      status: 'OPEN',
      priority: spec.priority || 'normal',
      createdAt: t,
      updatedAt: t,
      claimedAt: null,
      completedAt: null,
      expiresAt: spec.expiresAt || null,
      owner: spec.owner || 'operator',
      source: spec.source || 'detector',
      sourceMissionId: spec.sourceMissionId || null,
      sourceGoalId: spec.sourceGoalId || null,
      sourceAgentId: spec.sourceAgentId || null,
      verifier: spec.verifier || spec.verification || { name: 'manual', spec: {} },
      verification: null,          // last VerificationResult (v2 shape)
      resolution: null,            // 'auto_verified' | 'human_attested'
      evidence: [],
      attempts: 0,
      lastError: null,
      resumePolicy: spec.resumePolicy || 'auto',
      context: spec.context || null,
      transitions: [{ type: 'CREATED', at: t, actor: spec.source || 'detector', detail: spec.blockerKey || spec.title }],
      schema: 2,
    };
    db.actions.push(action);
    save(db);
    this.emit('human_action.requested', { actionId: action.id, blockerKey: action.blockerKey, title: action.title, sourceMissionId: action.sourceMissionId, sourceGoalId: action.sourceGoalId });
    return { action, created: true };
  }

  /**
   * Backfill goal linkage on an existing (deduped) action. First link
   * wins on the action side; a goal may still track many actions via its
   * own context.humanActions list.
   */
  linkGoal(id, goalId, actor) {
    return this._mutate(id, (a) => {
      if (a.sourceGoalId) return {};
      a.sourceGoalId = goalId;
      this._audit(a, 'LINKED', actor || 'system', `goal:${goalId}`);
      return {};
    });
  }

  _audit(a, type, actor, detail) {
    a.transitions.push({ type, at: now(), actor: actor || 'operator', detail: detail ?? null });
    a.updatedAt = now();
  }

  _mutate(id, fn) {
    const db = load();
    const a = db.actions.find((x) => x.id === id);
    if (!a) throw new Error('human action not found');
    const r = fn(a) || {};
    save(db);
    return { action: a, ...r };
  }

  claim(id, actor) {
    return this._mutate(id, (a) => {
      if (a.status !== 'OPEN' && a.status !== 'BLOCKED') throw new Error(`cannot claim — status is ${a.status}`);
      a.status = 'CLAIMED';
      a.claimedAt = now();
      this._audit(a, 'CLAIMED', actor);
      return {};
    });
  }

  /**
   * Re-run the verifier — the ONLY path to RESOLVED for verifiable
   * actions. A passed check resolves as auto_verified; a failed check
   * marks the action BLOCKED with the durable evidence of what is still
   * missing. VERIFYING is transient — the record shows a check ran.
   */
  async verify(id, actor) {
    const db = this._sweepExpiry(load());
    const a = db.actions.find((x) => x.id === id);
    if (!a) throw new Error('human action not found');
    if (a.status === 'RESOLVED') return { action: a, checked: false };
    if (TERMINAL_STATUSES.has(a.status)) throw new Error(`action is ${a.status} — terminal`);
    a.status = 'VERIFYING';
    a.attempts++;
    a.updatedAt = now();
    this._audit(a, 'VERIFY_REQUESTED', actor);
    save(db);

    const result = await runVerifier(a.verifier.name, a.verifier.spec, this.verifierDeps);

    return this._mutate(id, (rec) => {
      rec.verification = result;
      rec.lastError = result.passed ? null : result.failureReason;
      if (result.passed) {
        rec.status = 'RESOLVED';
        rec.completedAt = now();
        rec.resolution = 'auto_verified';
        rec.evidence.push({ at: now(), verificationId: result.verificationId, summary: result.safeSummary });
        this._audit(rec, 'VERIFIED', actor, result.safeSummary);
        this._audit(rec, 'RESOLVED', actor, 'auto_verified');
        this.emit('human_action.resolved', { actionId: rec.id, blockerKey: rec.blockerKey, resolution: 'auto_verified', sourceGoalId: rec.sourceGoalId, sourceMissionId: rec.sourceMissionId, verificationId: result.verificationId });
      } else {
        rec.status = 'BLOCKED';
        this._audit(rec, 'FAILED_VERIFICATION', actor, result.failureReason);
        this.emit('human_action.verification_failed', { actionId: rec.id, blockerKey: rec.blockerKey, reason: result.failureReason });
      }
      return { checked: true, result };
    });
  }

  /**
   * Human attestation — allowed ONLY for 'manual'-verifier actions.
   * The record honestly marks the resolution 'human_attested' vs
   * 'auto_verified' so the distinction survives in the audit trail.
   * Attestation can never override a failing machine check.
   */
  resolve(id, { note, actor } = {}) {
    return this._mutate(id, (a) => {
      if (a.status === 'RESOLVED') return {};
      if (TERMINAL_STATUSES.has(a.status)) throw new Error(`action is ${a.status} — terminal`);
      if (a.verifier.name !== 'manual') {
        throw new Error('verifier-backed action cannot be resolved by attestation — run verify');
      }
      a.status = 'RESOLVED';
      a.completedAt = now();
      a.resolution = 'human_attested';
      a.verification = {
        verificationId: 'ver_' + crypto.randomBytes(8).toString('hex'),
        verifier: 'manual', checkedAt: now(), passed: true, checks: [],
        evidence: { attested: true, note: note || null },
        safeSummary: 'human attested', failureReason: null,
      };
      this._audit(a, 'RESOLVED', actor, note || 'human attested');
      this.emit('human_action.resolved', { actionId: a.id, blockerKey: a.blockerKey, resolution: 'human_attested', sourceGoalId: a.sourceGoalId, sourceMissionId: a.sourceMissionId });
      return {};
    });
  }

  reject(id, { reason, actor } = {}) {
    return this._mutate(id, (a) => {
      if (a.status === 'RESOLVED') throw new Error('already resolved');
      a.status = 'REJECTED';
      a.completedAt = now();
      a.resolution = 'rejected';
      this._audit(a, 'REJECTED', actor, reason || 'rejected by human');
      this.emit('human_action.rejected', { actionId: a.id, blockerKey: a.blockerKey });
      return {};
    });
  }

  cancel(id, { reason, actor } = {}) {
    return this._mutate(id, (a) => {
      if (TERMINAL_STATUSES.has(a.status)) throw new Error(`action is ${a.status} — terminal`);
      a.status = 'CANCELLED';
      a.completedAt = now();
      this._audit(a, 'CANCELLED', actor, reason || 'cancelled');
      this.emit('human_action.cancelled', { actionId: a.id, blockerKey: a.blockerKey });
      return {};
    });
  }
}

module.exports = { HumanActionService, OPEN_STATUSES, TERMINAL_STATUSES };
