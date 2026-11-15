'use strict';

/**
 * Evidence-based gap candidates for owner-outcome prioritization (no LLM).
 */

const { ImprovementPlanner } = require('../evolution-engine/improvement-planner');

function gapTemplate(overrides) {
  return {
    id: 'unknown',
    observed_problem: '',
    evidence: { source: null, collected_at: null, detail: null },
    is_symptom: true,
    owner_impact: '',
    proposed_outcome: '',
    dependencies: [],
    uncertainty: 'medium',
    effort: 40,
    risk: 25,
    permissions_required: ['read_only'],
    acceptance_check: '',
    ...overrides,
  };
}

/**
 * @param {object} snapshot from buildOperationsEvidenceSnapshot
 * @param {object} [extras]
 * @returns {object[]}
 */
function collectGapsFromEvidence(snapshot, extras = {}) {
  const gaps = [];
  const at = snapshot.bundle_collected_at || new Date().toISOString();
  const live = snapshot.evidence?.live_system_probes;
  const frankPt = snapshot.evidence?.frank_production_truth;
  const caps = snapshot.capability_measurements;

  const rollup = snapshot.live_probe_rollup;
  const liveUntrusted =
    live?.evidence_state === 'failed' ||
    rollup == null ||
    rollup === 'UNAVAILABLE' ||
    rollup === 'DEGRADED';

  if (liveUntrusted) {
    gaps.push(
      gapTemplate({
        id: 'status-live-probes-failed-not-surfaced',
        observed_problem:
          'Live system probes failed but operators may still rely on file-based evidence without a clear degraded-status warning.',
        evidence: {
          source: 'lib/heidi/operations-evidence-snapshot.js',
          collected_at: at,
          detail: {
            live_probe_rollup: snapshot.live_probe_rollup,
            probe_state: live?.evidence_state,
            probe_error: live?.error || null,
          },
        },
        is_symptom: false,
        owner_impact: 'Accuracy of status claims; mobile ops may show stale or partial truth.',
        proposed_outcome:
          'Operational supervisor flags failed live probes and recommends treating overall status as degraded until probes succeed.',
        dependencies: ['operations-evidence-snapshot'],
        uncertainty: 'low',
        effort: 25,
        risk: 10,
        permissions_required: ['read_only', 'patch_repo_tests'],
        acceptance_check:
          'When live_system_probes evidence_state is failed, supervisor report includes failures[] and a treat_status_degraded recommendation.',
        owner_outcome_axis: 'accuracy',
        urgency: 92,
        confidence: 0.9,
      }),
    );
  }

  if (frankPt?.data?.not_live || frankPt?.evidence_state === 'stale') {
    gaps.push(
      gapTemplate({
        id: 'frank-telemetry-not-live',
        observed_problem: 'Frank production truth is cached or missing; must not be presented as live.',
        evidence: {
          source: 'frank_production_truth evidence block',
          collected_at: at,
          detail: {
            availability: frankPt.data?.availability,
            not_live: frankPt.data?.not_live,
            evidence_state: frankPt.evidence_state,
          },
        },
        is_symptom: true,
        owner_impact: 'False confidence in production state from cloud agents.',
        proposed_outcome: 'Collector re-run on Frank; Heidi surfaces CACHED/UNAVAILABLE clearly.',
        effort: 15,
        risk: 5,
        permissions_required: ['read_only'],
        acceptance_check: 'frank_truth_availability not LIVE in supervisor warnings.',
        owner_outcome_axis: 'accuracy',
        urgency: 70,
        confidence: 0.95,
        execution_mode: 'operator_frank_only',
      }),
    );
  }

  if (caps?.verification_contract_coverage?.verification_absent >= 1) {
    gaps.push(
      gapTemplate({
        id: 'capability-verification-absent',
        observed_problem: 'Registry capabilities lack verified execution contracts.',
        evidence: {
          source: 'capability_measurements',
          collected_at: at,
          detail: caps.verification_contract_coverage,
        },
        is_symptom: false,
        owner_impact: 'Cannot claim delivery-ready capabilities on Frank.',
        proposed_outcome: 'Incremental verification specs for highest-value capabilities only.',
        effort: 70,
        risk: 35,
        permissions_required: ['read_only', 'patch_repo_tests'],
        acceptance_check: 'verification_absent count decreases for targeted capability IDs.',
        owner_outcome_axis: 'reliability',
        urgency: 55,
        confidence: 0.8,
        execution_mode: 'document_and_patch',
      }),
    );
  }

  if (extras.local_ci_incident_open) {
    gaps.push(
      gapTemplate({
        id: 'frank-local-ci-unverified',
        observed_problem: 'Local-CI fix merged but Frank orchestrator pass not evidenced.',
        evidence: { source: 'operator runbook', collected_at: at, detail: extras.local_ci_incident_open },
        owner_impact: 'CI status on clean-main may still fail on Windows under PM2.',
        proposed_outcome: 'Frank runs node scripts/local-ci.js with polluted ESLint env.',
        effort: 10,
        risk: 5,
        permissions_required: ['operator_frank'],
        acceptance_check: 'local-ci/* GitHub statuses green from Frank.',
        owner_outcome_axis: 'reliability',
        urgency: 75,
        confidence: 0.85,
        execution_mode: 'operator_frank_only',
      }),
    );
  }

  return gaps;
}

/**
 * Explainable ranking: owner value + urgency - effort - risk.
 * @param {object[]} gaps
 */
function rankGaps(gaps) {
  return [...gaps]
    .map((g) => {
      const score =
        (g.urgency || 50) * 1.2 +
        (g.confidence || 0.5) * 20 -
        (g.effort || 50) * 0.4 -
        (g.risk || 30) * 0.5;
      return { ...g, rank_score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.rank_score - a.rank_score);
}

/**
 * Also feed evolution-engine planner for backlog shaping (dedup by id).
 */
function plannerBacklog(gaps) {
  const findings = gaps.map((g) => ({
    item_id: g.id,
    severity: g.urgency >= 80 ? 'high' : g.urgency >= 60 ? 'moderate' : 'info',
    code: g.id,
    message: g.observed_problem,
    subsystem: g.owner_outcome_axis || 'operations',
    evidence: g.evidence,
    remediation: g.proposed_outcome,
  }));
  return new ImprovementPlanner().plan(findings);
}

module.exports = {
  collectGapsFromEvidence,
  rankGaps,
  plannerBacklog,
};