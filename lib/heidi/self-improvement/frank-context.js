'use strict';

const { loadLatestFrankProductionTruth } = require('../../observation/frank-truth-loader');

/**
 * True when Frank collector evidence on disk is LIVE/fresh (not simulated).
 * Does not probe the network — only reads `.runtime/production-truth/`.
 */
function frankLiveTruthEligible(root, now = Date.now()) {
  const loaded = loadLatestFrankProductionTruth({ root, now });
  return loaded.availability === 'LIVE' && loaded.evidence_state === 'fresh';
}

module.exports = { frankLiveTruthEligible };