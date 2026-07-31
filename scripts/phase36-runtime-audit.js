#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const RuntimeTelemetry = require('../src/hydi-v3/RuntimeTelemetry');

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-p36-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const telemetry = new RuntimeTelemetry({ dataPath, storeFile: 'audit.jsonl', logger: { log: () => {}, error: () => {}, warn: () => {} } });
  await telemetry.start();

  telemetry.record({
    task: 'intentExtraction',
    selectedAgent: 'ConversationEngine',
    selectedModel: 'mock/local-llm',
    reasoning: 'fallback after deterministic routing',
    confidence: 0.92,
    latency: 1.4,
    outcome: 'success',
    fallbackUsed: false,
  });

  telemetry.record({
    task: 'recommendation',
    selectedAgent: 'ProductAgent',
    selectedModel: 'mock/local-llm',
    reasoning: 'strategic alignment with Resonate',
    confidence: 0.89,
    latency: 3.2,
    outcome: 'success',
    fallbackUsed: false,
  });

  await telemetry.stop();

  const persisted = await telemetry.read(100);
  assert(persisted.length === 2, `Expected 2 telemetry entries, got ${persisted.length}`);
  assert(persisted[0].task === 'intentExtraction', 'First entry should be intentExtraction');
  assert(persisted[1].selectedAgent === 'ProductAgent', 'Second entry should reference ProductAgent');
  assert(typeof persisted[0].latency === 'number', 'Latency should be recorded');
  assert(persisted[0].fallbackUsed === false, 'fallbackUsed should be recorded');

  const summary = telemetry.summary();
  assert(summary.total === 0, 'Buffer should be empty after flush');

  await fs.rm(dataPath, { recursive: true, force: true });

  console.log(JSON.stringify({ overall: 'PASS', entries: persisted.length }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
