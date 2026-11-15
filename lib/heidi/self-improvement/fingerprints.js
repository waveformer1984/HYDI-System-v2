'use strict';

const crypto = require('crypto');

/**
 * Deterministic problem fingerprint — not an LLM embedding.
 * @param {object} gap
 */
function fingerprintGap(gap) {
  const material = [
    gap.id || gap.code || '',
    gap.owner_outcome_axis || gap.subsystem || '',
    gap.observed_problem ? gap.observed_problem.slice(0, 120) : '',
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

function fingerprintBaseline(baseline = {}) {
  const material = JSON.stringify({
    live_probe_rollup: baseline.live_probe_rollup ?? null,
    live_probe_state: baseline.live_probe_state ?? null,
    status_truthfulness: baseline.status_truthfulness ?? null,
  });
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

module.exports = { fingerprintGap, fingerprintBaseline };