'use strict';

/**
 * ProtoForge AutoGate — KILO→ProtoForge automatic gating pipeline
 *
 * Takes an array of KILO hypotheses, evaluates each through the active
 * PolicyEngine, records decisions to the audit trail, and queues
 * escalations in the `actions` table for human review.
 *
 * Usage:
 *   const { autoGate } = require('./auto-gate');
 *   const result = await autoGate(hypotheses, stream);
 *   // result.approved  — proceed to emission layer
 *   // result.rejected  — blocked; do not execute
 *   // result.escalated — queued for review
 *   // result.summary   — { total, approved, rejected, escalated, stream }
 *
 * Designed to sit between KILO (hypothesis generation) and the emission
 * layer (execution). Only `approved` items should reach execution.
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../structured-logger').child({ component: 'AutoGate' });

// Lazy-required to avoid circular dependency issues and to allow tests to
// inject a mock engine via the `_engineFactory` export.
let _engineFactory = null;
function getEngineFactory() {
  if (!_engineFactory) {
    _engineFactory = require('./policy-engine').getPolicyEngine;
  }
  return _engineFactory;
}

// ── Core gate function ────────────────────────────────────────────────────────

/**
 * Gate an array of KILO hypotheses through the active ProtoForge policy.
 *
 * @param {object[]} hypotheses  Array of hypothesis objects from KILO
 * @param {string|null} stream   Revenue stream ('rezonate', 'galactic_bytes', etc.)
 * @param {object} [opts]
 * @param {Function} [opts.engineFactory]  Override for testing (receives stream)
 * @returns {Promise<GateResult>}
 */
async function autoGate(hypotheses, stream = null, opts = {}) {
  if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
    return {
      approved:  [],
      rejected:  [],
      escalated: [],
      decisions: [],
      summary: { total: 0, approved: 0, rejected: 0, escalated: 0, stream: stream || 'global' },
    };
  }

  const factory = opts.engineFactory || getEngineFactory();
  const engine  = await factory(stream);

  const approved  = [];
  const rejected  = [];
  const escalated = [];
  const decisions = [];

  for (const hyp of hypotheses) {
    const decision = engine.evaluate(hyp);
    decisions.push(decision);

    // Record to audit trail — fire-and-forget, never block the gate
    engine.recordDecision(decision).catch(err =>
      logger.error('Decision record error', { error: err.message })
    );

    switch (decision.decision) {
      case 'approve':
        approved.push({ hypothesis: hyp, decision });
        break;

      case 'reject':
        rejected.push({ hypothesis: hyp, decision });
        break;

      case 'escalate':
        escalated.push({ hypothesis: hyp, decision });
        // Queue for human review — fire-and-forget
        _queueEscalation(hyp, decision).catch(err =>
          logger.error('Escalation queue error', { error: err.message })
        );
        break;

      default:
        // Treat unknown outcome as reject (fail-closed)
        rejected.push({ hypothesis: hyp, decision });
    }
  }

  return {
    approved,
    rejected,
    escalated,
    decisions,
    summary: {
      total:     hypotheses.length,
      approved:  approved.length,
      rejected:  rejected.length,
      escalated: escalated.length,
      stream:    stream || 'global',
    },
  };
}

// ── Escalation queue ──────────────────────────────────────────────────────────

/**
 * Write a pending escalation row to the `actions` table.
 * Operators resolve these via the review queue.
 *
 * Callers that already have a concrete action type/payload to re-run later
 * (e.g. lib/orchestrator.ts's executeActions, for chat-originated actions)
 * write their own richer pending row instead of relying on this generic
 * one, since this function only has the KILO hypothesis to go on, not the
 * original action — there's nothing here yet that lib/action-approval.ts
 * could execute. This still records a real row for visibility/audit.
 *
 * Columns match the actual `actions` schema (supabase/heidi-init.sql:
 * id, session_id, task_name, status, payload, created_at) — an earlier
 * version of this function wrote action_type/metadata, which don't exist
 * on that table and made every insert fail silently (caught below).
 *
 * @param {object} hypothesis  Original KILO hypothesis
 * @param {object} decision    Decision object from PolicyEngine.evaluate()
 */
async function _queueEscalation(hypothesis, decision) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    logger.warn('Cannot queue escalation — Supabase env vars missing');
    return;
  }

  const supabase = createClient(url, key);
  const { error } = await supabase.from('actions').insert({
    session_id: hypothesis.session_id || null,
    task_name:  'protoforge_escalation',
    status:     'pending',
    payload: {
      hypothesis_id:   hypothesis.id || hypothesis.hypothesis_id || null,
      confidence:      decision.confidence,
      risk:            decision.risk,
      revenue_impact:  decision.revenueImpact,
      stream:          decision.stream,
      matched_rule_id: decision.matchedRuleId,
      reasoning:       decision.reasoning,
      decided_at:      decision.decidedAt,
    },
  });

  if (error) {
    logger.error('Failed to queue escalation', { error: error.message });
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  autoGate,
  _queueEscalation, // exposed for testing
  // Allow tests to inject a mock engine factory
  __setEngineFactory: (fn) => { _engineFactory = fn; },
  __resetEngineFactory: () => { _engineFactory = null; },
};
