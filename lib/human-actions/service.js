'use strict';

/**
 * HumanActionService — HYDI's mechanism for requesting work only a human
 * can do, and verifying it actually happened.
 *
 * Lifecycle:  open → claimed → resolved | rejected
 *   (resolved carries verification.ok plus the verifier's evidence)
 *
 * Dedupe: blocker_key is the stable identity of the underlying blocker —
 * requesting the same blocker twice returns the same open action rather
 * than minting duplicates (same discipline as the commercial bridge's
 * transaction-hash correlation).
 */

const crypto = require('crypto');
const { load, save } = require('./store');
const { runVerifier } = require('./verifiers');

function now() { return new Date().toISOString(); }

class HumanActionService {
  constructor({ emit } = {}) {
    this.emit = emit || (() => {});
  }

  list({ status } = {}) {
    const db = load();
    return db.actions.filter((a) => !status || a.status === status);
  }

  get(id) {
    return load().actions.find((a) => a.id === id) || null;
  }

  /**
   * Request a human action. Idempotent on blocker_key: an existing open or
   * claimed action for the same blocker is returned unchanged.
   * spec: { blockerKey, title, kind, instructions[], verification: {verifier, spec},
   *         context?, priority? }
   */
  request(spec) {
    if (!spec || !spec.title) throw new Error('human action requires a title');
    const db = load();
    const existing = db.actions.find((a) =>
      a.blocker_key === spec.blockerKey && (a.status === 'open' || a.status === 'claimed'));
    if (existing) return { action: existing, created: false };
    const action = {
      id: 'ha_' + crypto.randomBytes(8).toString('hex'),
      blocker_key: spec.blockerKey || null,
      title: spec.title,
      kind: spec.kind || 'general',
      instructions: spec.instructions || [],
      verification: spec.verification || { verifier: 'manual', spec: {} },
      context: spec.context || null,
      priority: spec.priority || 'normal',
      status: 'open',
      created_at: now(),
      claimed_at: null,
      resolved_at: null,
      resolution: null,          // 'auto_verified' | 'human_attested' | 'rejected'
      verify_result: null,       // { ok, evidence, reason, checked_at }
    };
    db.actions.push(action);
    save(db);
    this.emit('human_action.requested', { actionId: action.id, blockerKey: action.blocker_key, title: action.title });
    return { action, created: true };
  }

  _mutate(id, fn) {
    const db = load();
    const a = db.actions.find((x) => x.id === id);
    if (!a) throw new Error('human action not found');
    const r = fn(a);
    save(db);
    return { action: a, ...r };
  }

  claim(id) {
    return this._mutate(id, (a) => {
      if (a.status !== 'open') throw new Error(`cannot claim — status is ${a.status}`);
      a.status = 'claimed'; a.claimed_at = now();
      return {};
    });
  }

  /**
   * Re-run the verifier. If it passes the action resolves as auto_verified.
   * A failed check keeps the action open/claimed with the reason recorded —
   * a human cannot accidentally mark it done by asking.
   */
  async verify(id) {
    const a = this.get(id);
    if (!a) throw new Error('human action not found');
    if (a.status === 'resolved') return { action: a, checked: false };
    if (a.status === 'rejected') throw new Error('action was rejected');
    const result = await runVerifier(a.verification.verifier, a.verification.spec);
    const checked = { ...result, checked_at: now() };
    return this._mutate(id, (rec) => {
      rec.verify_result = checked;
      if (result.ok) {
        rec.status = 'resolved'; rec.resolved_at = now(); rec.resolution = 'auto_verified';
        this.emit('human_action.resolved', { actionId: rec.id, blockerKey: rec.blocker_key, resolution: 'auto_verified' });
      }
      return { checked: true, result };
    });
  }

  /**
   * Human attestation — for manual actions, or overriding a failed auto-check.
   * Only records that a human CLAIMED it; the record honestly marks the
   * resolution 'human_attested' vs 'auto_verified' so the distinction
   * survives in the audit trail.
   */
  resolve(id, { note } = {}) {
    return this._mutate(id, (a) => {
      if (a.status === 'resolved') return {};
      if (a.status === 'rejected') throw new Error('action was rejected');
      if (a.verification.verifier !== 'manual' && !(a.verify_result && a.verify_result.ok)) {
        throw new Error('auto-verified action cannot be resolved by attestation — run verify');
      }
      a.status = 'resolved'; a.resolved_at = now(); a.resolution = 'human_attested';
      a.verify_result = { ok: true, evidence: { attested: true, note: note || null }, checked_at: now() };
      this.emit('human_action.resolved', { actionId: a.id, blockerKey: a.blocker_key, resolution: 'human_attested' });
      return {};
    });
  }

  reject(id, { reason } = {}) {
    return this._mutate(id, (a) => {
      if (a.status === 'resolved') throw new Error('already resolved');
      a.status = 'rejected'; a.resolved_at = now(); a.resolution = 'rejected';
      a.verify_result = { ok: false, reason: reason || 'rejected by human', checked_at: now() };
      this.emit('human_action.rejected', { actionId: a.id, blockerKey: a.blocker_key });
      return {};
    });
  }
}

module.exports = { HumanActionService };
