#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const BaseAdapter = require('../src/hydi-v3/BaseAdapter');
const ModelManager = require('../src/hydi-v3/ModelManager');
const EmbeddingManager = require('../src/hydi-v3/EmbeddingManager');
const SemanticMemoryIndex = require('../src/hydi-v3/SemanticMemoryIndex');
const MemoryMaintenanceService = require('../src/hydi-v3/MemoryMaintenanceService');
const ResourceManager = require('../src/hydi-v3/ResourceManager');
const ModelSelectionPolicy = require('../src/hydi-v3/ModelSelectionPolicy');
const ExecutionPolicy = require('../src/hydi-v3/ExecutionPolicy');
const ExecutiveCockpit = require('../src/hydi-v3/ExecutiveCockpit');
const StrategicObjectives = require('../src/hydi-v3/StrategicObjectives');
const RuntimeTelemetry = require('../src/hydi-v3/RuntimeTelemetry');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

class MockAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'mock://local' });
    this.name = 'mock';
  }

  async health() { return { ok: true, status: 'ok' }; }
  async listModels() { return [{ id: 'mock/fast', name: 'mock/fast', provider: 'mock', capabilities: ['chat', 'embed'] }]; }
  async chat() { return { ok: true, text: 'ok' }; }
  async complete() { return { ok: true, text: 'ok' }; }
  async embed(text) {
    const v = Array.from({ length: 8 }, (_, i) => (String(text).length + i) % 7 / 10);
    return { ok: true, vector: v };
  }
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-p36-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });
  const report = { sections: [] };

  // 1. Runtime telemetry
  {
    const telemetry = new RuntimeTelemetry({ dataPath, logger: silent });
    await telemetry.start();
    telemetry.record({ task: 'test', selectedModel: 'mock/fast', confidence: 0.9, latency: 1, outcome: 'ok' });
    await telemetry.stop();
    const entries = await telemetry.read(100);
    assert(entries.length === 1, 'Telemetry should persist one entry');
    report.sections.push({ component: 'RuntimeTelemetry', passed: true, entries: entries.length });
  }

  // 2. ResourceManager + ModelSelectionPolicy
  {
    const rm = new ResourceManager({ logger: silent });
    const snap = rm.snapshot();
    assert(snap.cpus > 0, 'ResourceManager should detect CPUs');
    assert(snap.totalMem > 0, 'ResourceManager should detect total memory');

    const policy = new ModelSelectionPolicy();
    const candidates = [
      { id: 'tinyllama', capabilities: ['chat'], size: 637_000_000, contextSize: 2048, healthy: true },
      { id: 'qwen2.5:7b', capabilities: ['chat', 'reasoning'], size: 4_683_000_000, contextSize: 8192, healthy: true },
      { id: 'nomic-embed-text', capabilities: ['chat', 'embed'], size: 274_000_000, contextSize: 2048, healthy: true },
    ];
    const selected = policy.apply('embedding_task', candidates);
    assert(selected && selected.id === 'nomic-embed-text', 'Policy should select embedding model');
    report.sections.push({ component: 'ResourceManager+ModelSelectionPolicy', passed: true, selected: selected?.id });
  }

  // 3. ExecutionPolicy
  {
    const policy = new ExecutionPolicy({ logger: silent });
    assert(policy.authorize({ type: 'read_memory' }).allowed === true, 'read should be autonomous');
    assert(policy.authorize({ type: 'modify_file' }).allowed === false, 'modify should require approval');
    assert(policy.authorize({ type: 'credential_extraction' }).allowed === false, 'credential extraction should be forbidden');
    report.sections.push({ component: 'ExecutionPolicy', passed: true });
  }

  // 4. Memory hardening + maintenance
  {
    const mm = new ModelManager({ adapters: [new MockAdapter()], logger: silent });
    await mm.start();
    const em = await new EmbeddingManager({ modelManager: mm, dataPath, storeFile: 'mem.json' }).start();
    const smi = new SemanticMemoryIndex({ embeddingManager: em, logger: silent });
    const svc = new MemoryMaintenanceService({ semanticMemory: smi, embeddingManager: em, logger: silent });

    await smi.remember('Resonate launch is a complete success', { confidence: 0.9, source: 'executive-note', verified: true });
    await smi.remember('Resonate launch is blocked', { confidence: 0.3, source: 'rumor' });
    const conflicts = smi.detectContradictions();
    assert(conflicts.length >= 1, 'Should detect contradiction between success and blocked');

    await smi.remember('Old memory', { confidence: 0.9, createdAt: Date.now() - 100 * 86400000 });
    const maintenance = await svc.run();
    assert(maintenance.removed >= 1, 'Maintenance should remove stale/low-confidence memories');
    report.sections.push({ component: 'MemoryHardening+Maintenance', passed: true, conflicts: conflicts.length, removed: maintenance.removed });
  }

  // 5. Executive cockpit explanations
  {
    const strategic = new StrategicObjectives({ ownerPriority: 'Resonate' });
    const cockpit = new ExecutiveCockpit({ strategicObjectives: strategic, ownerPriority: 'Resonate', logger: silent });
    const recs = [
      { id: 'rec_0', action: 'Build Resonate prototype', title: 'Resonate prototype', reason: 'aligns with strategic objective', evidence: ['strategic objective'], category: 'engineering', risks: ['resource availability'] },
    ];
    cockpit.executiveOS = {
      morningBriefing: () => ({ recommendations: recs }),
    };
    const result = cockpit.focusForToday();
    assert(result.recommendations.length === 1, 'Cockpit should produce recommendations');
    assert(result.recommendations[0].why, 'Recommendation should include why explanation');
    assert(typeof result.recommendations[0].confidence === 'number', 'Recommendation should include confidence');
    report.sections.push({ component: 'ExecutiveCockpitExplanations', passed: true, confidence: result.recommendations[0].confidence });
  }

  await fs.rm(dataPath, { recursive: true, force: true });

  report.overall = 'PASS';
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
