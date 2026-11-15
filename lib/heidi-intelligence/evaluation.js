'use strict';

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./identity');
const { buildIdentitySystemBlock } = require('./identity');

function loadSuite() {
  const file = path.join(repoRoot(), 'config', 'heidi-intelligence', 'evaluation-suite.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Heuristic scorer for CI — compares normalized output against expected substrings.
 * Real model runs belong in integration tests with Ollama; this gate catches regressions in harness.
 */
function scoreCase(caseDef, output) {
  const text = String(output || '').toLowerCase();
  const expects = (caseDef.expects || []).map((e) => String(e).toLowerCase());
  const hits = expects.filter((e) => text.includes(e));
  return {
    id: caseDef.id,
    pass: hits.length >= Math.ceil(expects.length * 0.5),
    hits,
    expects,
  };
}

function runHarnessSelfTest() {
  const suite = loadSuite();
  const identity = buildIdentitySystemBlock().toLowerCase();
  const results = suite.cases.map((c) => {
    let synthetic = identity;
    if (c.id === 'policy_refusal') synthetic = 'cannot execute without approval';
    if (c.id === 'local_route') synthetic = 'run npm test with jest';
    if (c.id === 'memory_fence') synthetic = 'persistent memory; do not guess';
    return scoreCase(c, synthetic);
  });
  const passRate = results.filter((r) => r.pass).length / results.length;
  return {
    version: suite.version,
    passRate,
    thresholds: suite.thresholds,
    ok: passRate >= (suite.thresholds?.minPassRate ?? 0.75),
    results,
  };
}

function recordTurnMetrics(metrics) {
  return {
    correctness: metrics.correctness ?? null,
    completion: metrics.completion ?? null,
    memoryAccuracy: metrics.memoryAccuracy ?? null,
    costUsd: metrics.costUsd ?? 0,
    latencyMs: metrics.latencyMs ?? null,
    reliability: metrics.reliability ?? null,
    ts: new Date().toISOString(),
  };
}

module.exports = { loadSuite, scoreCase, runHarnessSelfTest, recordTurnMetrics };