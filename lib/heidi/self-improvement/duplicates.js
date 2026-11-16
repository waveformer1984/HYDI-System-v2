'use strict';

const { fingerprintGap } = require('./fingerprints');

/**
 * @param {object} gap
 * @param {object[]} history
 */
function analyzeDuplicates(gap, history = []) {
  const fp = fingerprintGap(gap);
  const sameFp = history.filter((h) => h.problem_fingerprint === fp);
  const sameId = history.filter((h) => h.gap_id === gap.id);

  const failedTwice = sameFp.filter((h) => h.outcome_class === 'REGRESSED' || h.outcome_class === 'INCONCLUSIVE').length >= 2;
  const improvedBefore = sameFp.some((h) => h.outcome_class === 'IMPROVED');
  const deferred = sameFp.filter((h) => h.deferred);
  const activeRunning = sameFp.some((h) => h.lifecycle_stage === 'EXECUTING');

  let recommendation = 'proceed';
  let duplicate_of = null;

  if (improvedBefore) {
    recommendation = 'skip_duplicate';
    duplicate_of = sameFp.find((h) => h.outcome_class === 'IMPROVED')?.mission_id || null;
  } else if (failedTwice) {
    recommendation = 'defer_human';
  } else if (activeRunning) {
    recommendation = 'block_active_duplicate';
  }

  return {
    fingerprint: fp,
    prior_count: sameFp.length,
    same_gap_id_count: sameId.length,
    failed_attempts: sameFp.filter((h) => ['REGRESSED', 'INCONCLUSIVE', 'UNVERIFIED'].includes(h.outcome_class)).length,
    improved_before: improvedBefore,
    deferred_count: deferred.length,
    recommendation,
    duplicate_of,
    should_create_mission: recommendation === 'proceed' || recommendation === 'defer_human',
  };
}

module.exports = { analyzeDuplicates };