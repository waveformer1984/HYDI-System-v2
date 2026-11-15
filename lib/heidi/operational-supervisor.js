'use strict';

/**
 * Read-only operational supervisor — composes existing evidence; does not restart services.
 */

const { buildOperationsEvidenceSnapshot } = require('./operations-evidence-snapshot');
const { loadLatestFrankProductionTruth } = require('../observation/frank-truth-loader');

async function buildOperationalSupervisorReport(opts = {}) {
  const snapshot = await buildOperationsEvidenceSnapshot(opts);
  const frank = loadLatestFrankProductionTruth({ root: opts.root, now: opts.now });

  const failures = [];
  const warnings = [];
  const recommendations = [];

  for (const [key, block] of Object.entries(snapshot.evidence || {})) {
    if (block.evidence_state === 'failed') failures.push({ area: key, error: block.error });
    if (block.evidence_state === 'stale') warnings.push({ area: key, error: block.error || 'stale' });
  }

  if (frank.availability === 'UNAVAILABLE') {
    warnings.push({ area: 'frank_production_truth', error: frank.error || 'missing' });
    recommendations.push({
      action: 'run_collector',
      detail: 'powershell -File scripts/frank-production-truth-collect.ps1 on Frank',
      risk: 'read_only',
    });
  } else if (frank.availability === 'CACHED') {
    warnings.push({ area: 'frank_production_truth', error: 'cached telemetry — not live' });
    recommendations.push({ action: 'refresh_collector', detail: 'Re-run Frank collector', risk: 'read_only' });
  }

  if (frank.local_ci_hint?.eslint_use_flat_config_process) {
    recommendations.push({
      action: 'unset_eslint_flat_config',
      detail: 'Remove ESLINT_USE_FLAT_CONFIG from PM2/user env; merge local-ci fix',
      risk: 'infra',
    });
  }

  const missions = snapshot.evidence?.missions?.data;
  const awaiting = missions?.awaiting_approval_count ?? missions?.awaiting?.length;
  if (typeof awaiting === 'number' && awaiting > 0) {
    recommendations.push({
      action: 'review_missions',
      detail: `${awaiting} mission(s) awaiting approval`,
      risk: 'human_required',
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    live_probe_rollup: snapshot.live_probe_rollup,
    frank_truth_availability: frank.availability,
    failures,
    warnings,
    recommendations,
    evidence_bundle_collected_at: snapshot.bundle_collected_at,
  };
}

module.exports = { buildOperationalSupervisorReport };