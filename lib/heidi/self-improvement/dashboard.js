'use strict';

const { buildOperationalSupervisorReport } = require('../operational-supervisor');
const { loadAllMissions, loadIndex } = require('./history');
const { loadActiveMission } = require('../self-improvement-store');
const { rankWithHistory } = require('./scoring');
const { collectGapsFromEvidence } = require('../self-improvement-gaps');
const { buildOperationsEvidenceSnapshot } = require('../operations-evidence-snapshot');
const { deriveLifecycleStage } = require('./verification');
const { LIMITS } = require('../bounded-self-improvement-loop');

async function buildImprovementDashboard(opts = {}) {
  const root = opts.root || process.cwd();
  const history = loadAllMissions(root);
  const active = loadActiveMission(root);
  const index = loadIndex(root);

  let supervisor = null;
  let snapshot = null;
  try {
    snapshot = await buildOperationsEvidenceSnapshot({
      root,
      fetchImpl: opts.fetchImpl,
      env: opts.env || process.env,
    });
    supervisor = await buildOperationalSupervisorReport({ root, fetchImpl: opts.fetchImpl, env: opts.env });
  } catch {
    /* partial */
  }

  const gaps = snapshot
    ? rankWithHistory(collectGapsFromEvidence(snapshot, opts), history)
    : [];

  const withLifecycle = history.map((h) => ({
    mission_id: h.mission_id,
    gap_id: h.gap_id,
    outcome_class: h.outcome_class,
    proof_label: h.proof_label,
    lifecycle_stage: h.lifecycle_stage || deriveLifecycleStage(h),
    recorded_at: h.recorded_at,
  }));

  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    operational_condition: {
      status_truthfulness: supervisor?.status_truthfulness ?? 'unknown',
      live_probe_rollup: snapshot?.live_probe_rollup ?? null,
      frank_truth: supervisor?.frank_truth_availability ?? 'UNAVAILABLE',
    },
    highest_priority_improvement: gaps[0]
      ? {
          id: gaps[0].id,
          problem: gaps[0].observed_problem,
          priority_score: gaps[0].rank_score,
          scoring: gaps[0].scoring,
          duplicate_analysis: gaps[0].duplicate_analysis,
        }
      : null,
    active_mission: active,
    governance: { limits: LIMITS, owner_request_required: true },
    history_summary: {
      total: history.length,
      improved: history.filter((h) => h.outcome_class === 'IMPROVED').length,
      regressed: history.filter((h) => h.outcome_class === 'REGRESSED').length,
      inconclusive: history.filter((h) => h.outcome_class === 'INCONCLUSIVE').length,
      unverified: history.filter((h) => h.outcome_class === 'UNVERIFIED').length,
      fingerprint_index_size: Object.keys(index.fingerprints || {}).length,
    },
    missions: withLifecycle,
    deferred: gaps.filter((g) => g.duplicate_analysis?.recommendation === 'defer_human').map((g) => g.id),
    approvals_required: [
      'merge',
      'deploy',
      'frank_operator_tasks',
      'SELF_IMPROVE_ALLOW_PATCH',
      'external_communication',
    ],
    verification_environment: opts.frankReachable ? 'FRANK_VERIFIED' : 'CLOUD_VERIFIED',
    improvement_brief_pointer: 'scripts/heidi-self-improve.js run --owner-requested',
  };
}

module.exports = { buildImprovementDashboard };