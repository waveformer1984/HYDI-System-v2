'use strict';

/**
 * ProtoForge Policy Engine — DSL Loader + Evaluator
 *
 * Lifecycle:
 *   1. init(stream?)     — load active policy from Supabase; subscribe to Realtime
 *   2. evaluate(hyp)     — run hypothesis against rule tree; returns Decision
 *   3. recordDecision(d) — write Decision to `decisions` table (fire-and-forget)
 *   4. destroy()         — unsubscribe Realtime channel
 *
 * Rule DSL operators (inside rule.if field comparisons):
 *   gte, lte, gt, lt, eq, neq, in, nin
 *
 * A hypothesis object shape (from KILO):
 *   { id, confidence, risk, revenue_impact, stream, ...metadata }
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

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
  constructor(supabaseUrl, supabaseKey) {
    this._client = createClient(supabaseUrl, supabaseKey);
    this._policy = null;       // { id, version, name, rules, stream }
    this._channel = null;
    this._stream = null;
    this._initialized = false;
    this._reloadCallbacks = [];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Load active policy and subscribe to Realtime hot-reload.
   * @param {string|null} stream  Revenue stream (null = global)
   */
  async init(stream = null) {
    this._stream = stream;
    await this._loadPolicy(stream);
    this._subscribeRealtime();
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
   * Persist a decision to the `decisions` table.
   * Fire-and-forget — caller should not await unless it needs the ID.
   * The row's id is the client-generated `decisionObj.decisionId` (see
   * _buildDecision), not the DB default, so callers already have a stable
   * id to pass to recordOutcome() without waiting on this insert.
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

    const { data, error } = await this._client
      .from('decisions')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      console.error('[PROTOFORGE] Failed to record decision:', error.message);
      return null;
    }

    return data?.id || decisionObj.decisionId || null;
  }

  /**
   * Backfill outcome after execution completes (called by emission layer).
   * @param {string} decisionId    UUID from recordDecision
   * @param {'success'|'failure'|'unknown'} outcome
   * @param {object} detail        { revenue_actual, error, latency_ms, ... }
   */
  async recordOutcome(decisionId, outcome, detail = {}) {
    const { error } = await this._client
      .from('decisions')
      .update({
        outcome,
        outcome_at: new Date().toISOString(),
        outcome_detail: detail,
      })
      .eq('id', decisionId);

    if (error) {
      console.error('[PROTOFORGE] Failed to record outcome:', error.message);
    }
  }

  /**
   * Register a callback fired whenever the policy hot-reloads.
   * cb(newPolicy) — newPolicy is the raw DB row
   */
  onReload(cb) {
    this._reloadCallbacks.push(cb);
  }

  /** Currently loaded policy (null if none active) */
  get activePolicy() {
    return this._policy ? { ...this._policy } : null;
  }

  /** Unsubscribe Realtime channel */
  async destroy() {
    if (this._channel) {
      await this._client.removeChannel(this._channel);
      this._channel = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  async _loadPolicy(stream) {
    // Try stream-specific first, fall back to global (stream IS NULL)
    let policy = null;

    if (stream) {
      const { data } = await this._client
        .from('policies')
        .select('id, version, name, description, rules, stream')
        .eq('stream', stream)
        .eq('is_active', true)
        .maybeSingle();
      policy = data;
    }

    if (!policy) {
      const { data } = await this._client
        .from('policies')
        .select('id, version, name, description, rules, stream')
        .is('stream', null)
        .eq('is_active', true)
        .maybeSingle();
      policy = data;
    }

    if (policy) {
      this._policy = policy;
      console.log(`[PROTOFORGE] Policy loaded: ${policy.name} v${policy.version}${stream ? ` (stream: ${stream})` : ' (global)'}`);
    } else {
      this._policy = null;
      console.warn(`[PROTOFORGE] No active policy found${stream ? ` for stream: ${stream}` : ''}. Failing closed.`);
    }
  }

  _subscribeRealtime() {
    this._channel = this._client
      .channel('protoforge-policy-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'policies' },
        async (payload) => {
          const row = payload.new || payload.old;
          const affectsUs =
            row && (row.stream === this._stream || row.stream === null);

          if (!affectsUs) return;

          console.log('[PROTOFORGE] Policy change detected — reloading...');
          await this._loadPolicy(this._stream);

          for (const cb of this._reloadCallbacks) {
            try { cb(this._policy); } catch (_) {}
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[PROTOFORGE] Realtime hot-reload active');
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[PROTOFORGE] Realtime subscription error — hot-reload degraded');
        }
      });
  }

  _buildDecision(hypothesis, decision, matchedRuleId, reasoning) {
    return {
      // Generated here (not left to the DB default) so callers have a
      // stable id immediately — e.g. to pass to recordOutcome() once
      // execution completes — without awaiting recordDecision()'s insert.
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
// Singleton factory — one engine per stream
// ---------------------------------------------------------------------------
const _engines = new Map();

async function getPolicyEngine(stream = null) {
  const key = stream || '__global__';
  if (_engines.has(key)) return _engines.get(key);

  const url = process.env.SUPABASE_URL;
  const key_ = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key_) {
    throw new Error('[PROTOFORGE] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const engine = new PolicyEngine(url, key_);
  await engine.init(stream);
  _engines.set(key, engine);
  return engine;
}

// ---------------------------------------------------------------------------
// Standalone outcome backfill — self-evaluation feedback loop
// ---------------------------------------------------------------------------

/**
 * Backfill a decision's outcome once execution completes. Standalone
 * (doesn't need a PolicyEngine instance/policy loaded — outcome columns
 * are independent of which policy made the decision) so callers like
 * lib/orchestrator.ts can record real success/failure against the
 * `decisions` audit trail without holding a policy engine reference.
 *
 * @param {string} decisionId  UUID from evaluate()'s decisionId field
 * @param {'success'|'failure'|'unknown'} outcome
 * @param {object} [detail]  { error, result, latency_ms, ... }
 */
async function recordOutcome(decisionId, outcome, detail = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[PROTOFORGE] Cannot record outcome — Supabase env vars missing');
    return;
  }

  try {
    const client = createClient(url, key);
    const { error } = await client
      .from('decisions')
      .update({ outcome, outcome_at: new Date().toISOString(), outcome_detail: detail })
      .eq('id', decisionId);

    if (error) {
      console.error('[PROTOFORGE] Failed to record outcome:', error.message);
    }
  } catch (error) {
    console.error('[PROTOFORGE] Failed to record outcome:', error.message);
  }
}

module.exports = { PolicyEngine, getPolicyEngine, evaluateRules, matchCondition, recordOutcome };
