'use strict';

/**
 * Shared probe used by scripts/hydi-verify.js — unregistered destructive
 * actions must never AUTO-APPROVE even with exec enabled and high confidence.
 */
const path = require('path');

function probeOutOfBoundsGate(rootDir) {
  const root = rootDir || path.join(__dirname, '..', '..');
  const { safeEvaluateTripleGate } = require(path.join(root, 'lib/governance/tripleGate'));
  const { registeredActionTypes } = require(path.join(root, 'lib/governance/action-registry'));
  return safeEvaluateTripleGate({
    execEnabled: 'true',
    bounds: { auto_approve_threshold: 0.85 },
    knownActions: registeredActionTypes(),
    task: { type: 'rm_rf_everything', division: 'ops', confidence: 0.99, within_bounds: true },
  });
}

/** @returns {boolean} true when governance would deny auto-execution */
function gateProbePasses(rootDir) {
  const r = probeOutOfBoundsGate(rootDir);
  return r.verdict !== 'AUTO-APPROVE';
}

module.exports = { probeOutOfBoundsGate, gateProbePasses };
