'use strict';

/**
 * ProtoForge Policy Engine — DSL Loader + Evaluator
 *
 * Lifecycle:
 *   1. init(stream?)     — load active policy from the configured store
 *   2. evaluate(hyp)     — run hypothesis against rule tree; returns Decision
 *   3. recordDecision(d) — write Decision to audit store (fire-and-forget)
 *   4. destroy()         — unsubscribe any realtime channel
 *
 * Rule DSL operators (inside rule.if field comparisons):
 *   gte, lte, gt, lt, eq, neq, in, nin
 *
 * A hypothesis object shape (from KILO):
 *   { id, confidence, risk, revenue_impact, stream, ...metadata }
 */

const crypto = require('crypto');
const LocalPolicyStore = require('./stores/local-policy-store');
const SupabasePolicyStore = require('./stores/supabase-policy-store');

// ---------------------------------------------------------------------------
// Operator evaluators
// ---------------------------------------------------------------------------
const OPS = {
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
  gt:  (a, b) => a > b,
  lt:  (a, b) => a < b,
  eq:  (a, b) => a === b,
  neq: (a, b) => a !== b,
  in:  (a, b) => Array.isArray(b) && b.includes(a),
  nin: (a, b) => Array.isArray(b) && !b.includes(a),
};

/**
 * Evaluate a single condition map against a hypothesis.
 * condition: { confidence: { gte: 0.85 }, risk: { lte: 0.3 }, ... }
 * All fields must pass (AND semantics).
 */
function matchCondition(condition, hyp) {
  for (const [field, ops] of Object.entries(condition)) {
    const actual = hyp[field];
    if (actual === undefined || actual === null) return false;
    for (const [op, threshold] of Object.entries(ops)) {
      const fn = OPS[op];
      if (!fn) throw new Error(`Unknown DSL operator: ${op}`);
      if (!fn(actual, threshold)) return false;
    }
  }
  return true;
}

/**
 * Evaluate all rules in priority order (ascending).
 * Returns { decision, matchedRuleId } — decision is 'approve'|'reject'|'escalate'.
 */
function evaluateRules(policyRules, hyp) {
  const rules = policyRules.rules || [];
  const defaultDecision = policyRules.default || 'reject';

  // Sort ascending by priority (lower number = higher priority)
  const sorted = [...rules].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  for (const rule of sorted) {
    if (!rule.if || matchCondition(rule.if, hyp)) {
      return { decision: rule.then, matchedRuleId: rule.id };
    }
  }

  return { decision: defaultDecision, matchedRuleId: null };
}

// ---------------------------------------------------------------------------
// PolicyEngine class
// ---------------------------------------------------------------------------
class PolicyEngine {
  constructor(storeOrUrl, key) {
    if (storeOrUrl && typeof storeOrUrl === 'object' && storeOrUrl.loadPolicy) {
      this._store = storeOrUrl;
    } else if (typeof storeOrUrl === 'string' && typeof key === 'string') {
      this._store = new SupabasePolicyStore(storeOrUrl, key);
    } else {
      this._store = new LocalPolicyStore();
    }

    this._policy = null;
    this._channel = null;
    this._stream = null;
    this._initialized = false;
    this._reloadCallbacks = [];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Load active policy and, for Supabase, subscribe to Realtime hot-reload.
   * @param {string|null} stream  Revenue stream (null = global)
   */
  async init(stream = null) {
    this._stream = stream;
    await this._loadPolicy(stream);
    this._subscribeToChanges();
    this._initialized = true;
  }

  /**
   * Evaluate a KILO hypothesis against the loaded policy.
   * @param {object} hypothesis  { id, confidence, risk, revenue_impact, stream, ... }
   * @returns {object}  Decision object ready for recordDecision()
   */
  evaluate(hypothesis) {
    if (!this._policy) {
      // No active policy — fail closed
      return this._buildDecision(hypothesis, 'reject', null, 'no-active-policy');
    }

    const { decision, matchedRuleId } = evaluateRules(this._policy.rules, hypothesis);

    const reasoning = matchedRuleId
      ? `Rule '${matchedRuleId}' matched (policy: ${this._policy.name} v${this._policy.version})`
      : `Default '${decision}' applied — no rule matched (policy: ${this._policy.name} v${this._policy.version})`;

    return this._buildDecision(hypothesis, decision, matchedRuleId, reasoning);
  }

  /**
   * Persist a decision to the audit store.
   * Fire-and-forget — caller should not await unless it needs the ID.
   * @param {object} decisionObj  Result from evaluate()
   * @returns {Promise<string|null>}  Decision UUID or null on error
   */
  async recordDecision(decisionObj) {
    const row = {
      id:             decisionObj.decisionId    || undefined,
      event_hash:     decisionObj.eventHash     || this._hashHypothesis(decisionObj.hypothesisId),
      hypothesis_id:  decisionObj.hypothesisId,
      policy_id:      this._policy?.id          || null,
      policy_version: this._policy?.version     || 0,
      decision:       decisionObj.decision,
      matched_rule_id: decisionObj.matchedRuleId || null,
      confidence:     decisionObj.confidence     ?? null,
      risk_score:     decisionObj.risk           ?? null,
      revenue_impact: decisionObj.revenueImpact  ?? null,
      stream:         decisionObj.stream         || this._stream,
      reasoning:      decisionObj.reasoning      || null,
    };

    try {
      return await this._store.recordDecision(row);
    } catch (err) {
      console.error('[PROTOFORGE] Failed to record decision:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Backfill outcome after execution completes.
   * @param {string} decisionId    UUID from evaluate()'s decisionId field
   * @param {'success'|'failure'|'unknown'} outcome
   * @param {object} detail        { revenue_actual, error, latency_ms, ... }
   */
  async recordOutcome(decisionId, outcome, detail = {}) {
    try {
      await this._store.recordOutcome(decisionId, outcome, detail);
    } catch (err) {
      console.error('[PROTOFORGE] Failed to record outcome:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Register a callback fired whenever the policy hot-reloads.
   * cb(newPolicy) — newPolicy is the raw policy object
   */
  onReload(cb) {
    this._reloadCallbacks.push(cb);
  }

  /** Currently loaded policy (null if none active) */
  get activePolicy() {
    return this._policy ? { ...this._policy } : null;
  }

  /** Backwards-compatible access to the underlying Supabase client (tests only). */
  get _client() {
    return this._store?._client || null;
  }

  set _client(v) {
    if (this._store) this._store._client = v;
  }

  /** Unsubscribe Realtime channel */
  async destroy() {
    await this._store.destroy(this._channel);
    this._channel = null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  async _loadPolicy(stream) {
    const policy = await this._store.loadPolicy(stream);

    if (policy) {
      this._policy = policy;
      console.log(`[PROTOFORGE] Policy loaded: ${policy.name} v${policy.version}${stream ? ` (stream: ${stream})` : ' (global)'}`);
    } else {
      this._policy = null;
      console.warn(`[PROTOFORGE] No active policy found${stream ? ` for stream: ${stream}` : ''}. Failing closed.`);
    }
  }

  _subscribeToChanges() {
    if (typeof this._store.subscribeToPolicyChanges === 'function') {
      this._channel = this._store.subscribeToPolicyChanges(this._stream);
    }

    if (typeof this._store.onReload === 'function') {
      this._store.onReload((policy) => {
        this._policy = policy;
        for (const cb of this._reloadCallbacks) {
          try {
            cb(policy);
          } catch (err) {
            console.warn('[PROTOFORGE] Reload callback failed:', err instanceof Error ? err.message : err);
          }
        }
      });
    }
  }

  _buildDecision(hypothesis, decision, matchedRuleId, reasoning) {
    return {
      decisionId:    crypto.randomUUID(),
      hypothesisId:  hypothesis.id   || hypothesis.hypothesis_id || crypto.randomUUID(),
      eventHash:     hypothesis.event_hash || null,
      decision,
      matchedRuleId: matchedRuleId   || null,
      confidence:    hypothesis.confidence   ?? null,
      risk:          hypothesis.risk         ?? null,
      revenueImpact: hypothesis.revenue_impact ?? null,
      stream:        hypothesis.stream       || this._stream,
      reasoning,
      decidedAt:     new Date().toISOString(),
    };
  }

  _hashHypothesis(hypothesisId) {
    return crypto
      .createHash('sha256')
      .update(String(hypothesisId))
      .digest('hex');
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function shouldUseSupabase() {
  return (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.HYDI_POLICY_SOURCE !== 'local'
  );
}

function createPolicyStore() {
  if (shouldUseSupabase()) {
    return new SupabasePolicyStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return new LocalPolicyStore();
}

// ---------------------------------------------------------------------------
// Singleton factory — one engine per stream
// ---------------------------------------------------------------------------
const _engines = new Map();

async function getPolicyEngine(stream = null) {
  const key = stream || '__global__';
  if (_engines.has(key)) return _engines.get(key);

  const store = createPolicyStore();
  const engine = new PolicyEngine(store);
  await engine.init(stream);
  _engines.set(key, engine);
  return engine;
}

function getDefaultPolicyStore() {
  return createPolicyStore();
}

// ---------------------------------------------------------------------------
// Standalone outcome backfill — self-evaluation feedback loop
// ---------------------------------------------------------------------------

async function recordOutcome(decisionId, outcome, detail = {}) {
  if (process.env.HYDI_POLICY_SOURCE === 'local') {
    const store = new LocalPolicyStore();
    try {
      await store.recordOutcome(decisionId, outcome, detail);
    } catch (err) {
      console.error('[PROTOFORGE] Failed to record outcome:', err instanceof Error ? err.message : err);
    }
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[PROTOFORGE] Cannot record outcome — Supabase env vars missing');
    return;
  }

  const store = new SupabasePolicyStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    await store.recordOutcome(decisionId, outcome, detail);
  } catch (err) {
    console.error('[PROTOFORGE] Failed to record outcome:', err instanceof Error ? err.message : err);
  }
}

module.exports = { PolicyEngine, getPolicyEngine, evaluateRules, matchCondition, recordOutcome };
