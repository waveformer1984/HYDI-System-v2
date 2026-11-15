'use strict';

const { OUTCOME_CLASS } = require('./verification');

function compareBaseline(before = {}, after = {}) {
  const metrics = [];
  const bRollup = before.live_probe_rollup;
  const aRollup = after.live_probe_rollup;
  const bTruth = before.status_truthfulness;
  const aTruth = after.status_truthfulness;

  if (bTruth === 'degraded' && aTruth === 'probes_ok') {
    metrics.push({ id: 'status_truthfulness', direction: 'improved' });
  } else if (bTruth === 'probes_ok' && aTruth === 'degraded') {
    metrics.push({ id: 'status_truthfulness', direction: 'regressed' });
  } else if (bTruth === aTruth) {
    metrics.push({ id: 'status_truthfulness', direction: 'unchanged' });
  } else {
    metrics.push({ id: 'status_truthfulness', direction: 'inconclusive' });
  }

  if (bRollup === 'UNAVAILABLE' && aRollup === 'HEALTHY') {
    metrics.push({ id: 'live_probe_rollup', direction: 'improved' });
  } else if (bRollup === 'HEALTHY' && aRollup === 'UNAVAILABLE') {
    metrics.push({ id: 'live_probe_rollup', direction: 'regressed' });
  }

  return metrics;
}

/**
 * @param {object} input
 */
function classifyOutcome({ baseline, after, testsPassed, verifyCompleted, verifyEvidence }) {
  if (!baseline || !after) return OUTCOME_CLASS.UNVERIFIED;
  if (!testsPassed) return OUTCOME_CLASS.INCONCLUSIVE;
  if (!verifyCompleted) return OUTCOME_CLASS.UNVERIFIED;

  const metrics = compareBaseline(baseline, after);
  const improved = metrics.some((m) => m.direction === 'improved');
  const regressed = metrics.some((m) => m.direction === 'regressed');

  if (verifyEvidence?.hasRec === false && baseline.status_truthfulness === 'degraded') {
    return OUTCOME_CLASS.REGRESSED;
  }
  if (improved && !regressed) return OUTCOME_CLASS.IMPROVED;
  if (regressed && !improved) return OUTCOME_CLASS.REGRESSED;
  if (!improved && !regressed) return OUTCOME_CLASS.UNCHANGED;
  return OUTCOME_CLASS.INCONCLUSIVE;
}

module.exports = { compareBaseline, classifyOutcome };