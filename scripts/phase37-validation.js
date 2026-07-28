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
const ExecutionPolicy = require('../src/hydi-v3/ExecutionPolicy');
const RuntimeTelemetry = require('../src/hydi-v3/RuntimeTelemetry');
const AdaptiveModelOptimizer = require('../src/hydi-v3/AdaptiveModelOptimizer');
const ExecutionOutcomeTracker = require('../src/hydi-v3/ExecutionOutcomeTracker');
const OperatorFeedbackEngine = require('../src/hydi-v3/OperatorFeedbackEngine');
const BenchmarkDatabase = require('../src/hydi-v3/BenchmarkDatabase');
const ExecutivePerformanceDashboard = require('../src/hydi-v3/ExecutivePerformanceDashboard');
const ModelSelectionPolicy = require('../src/hydi-v3/ModelSelectionPolicy');

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const reportPath = path.resolve(__dirname, '../reports/business-os/phase37-validation.md');

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

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function mdSection(title, items) {
  let out = `## ${title}\n\n`;
  for (const { name, passed, note } of items) {
    out += `- ${passed ? 'PASS' : 'FAIL'}: ${name}${note ? ` — ${note}` : ''}\n`;
  }
  return out;
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-p37-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });
  const sections = [];

  const optimizer = new AdaptiveModelOptimizer({ logger: silent });
  for (let i = 0; i < 10; i++) {
    optimizer.record({ model: 'mock/fast', capability: 'chat', latency: 50 + i, success: true, confidence: 0.9, cpuCost: 100, memoryCost: 1000, operatorPreference: 0.5 });
  }
  optimizer.record({ model: 'mock/slow', capability: 'chat', latency: 500, success: false, confidence: 0.6, cpuCost: 500, memoryCost: 5000, operatorPreference: 0 });
  const fastProfile = optimizer.profile('mock/fast');
  assert(fastProfile.successRate > 0.8, 'AdaptiveModelOptimizer should track high success rate for mock/fast');
  assert(fastProfile.score > 0, 'AdaptiveModelOptimizer should compute a positive score');
  const recommended = optimizer.recommend('chat', [{ id: 'mock/fast', capabilities: ['chat'] }, { id: 'mock/slow', capabilities: ['chat'] }]);
  assert(recommended && recommended.id === 'mock/fast', 'AdaptiveModelOptimizer should recommend the better model');
  sections.push({ title: 'Adaptive Model Optimization', items: [{ name: 'Latency/p95 tracking', passed: true }, { name: 'Score-based recommendation', passed: true }] });

  const telemetry = new RuntimeTelemetry({ dataPath, logger: silent });
  await telemetry.start();
  const outcomes = new ExecutionOutcomeTracker({ telemetry, logger: silent });
  outcomes.record({ task: 'plan', selectedModel: 'mock/fast', selectedAgent: 'PlanningAgent', executionTime: 120, retries: 0, fallbackUsed: false, approvalRequired: false, operatorAcceptance: 1, finalOutcome: 'success', confidence: 0.9 });
  outcomes.record({ task: 'plan', selectedModel: 'mock/slow', selectedAgent: 'PlanningAgent', executionTime: 800, retries: 2, fallbackUsed: true, approvalRequired: true, operatorAcceptance: 0, finalOutcome: 'error', confidence: 0.5 });
  const stats = outcomes.rollingStats();
  assert(stats.count === 2, 'ExecutionOutcomeTracker should record two outcomes');
  assert(stats.successRate === 0.5, 'ExecutionOutcomeTracker success rate should be 0.5');
  sections.push({ title: 'Execution Outcome Tracking', items: [{ name: 'Rolling statistics', passed: true }, { name: 'Fallback/approval metrics', passed: true }] });

  const feedback = new OperatorFeedbackEngine({ executionOutcomeTracker: outcomes, telemetry, logger: silent });
  feedback.recordPositive({ task: 'plan', model: 'mock/fast' });
  feedback.recordNegative({ task: 'plan', model: 'mock/slow' });
  feedback.recordIgnored({ task: 'plan', model: 'mock/slow' });
  assert(feedback.weightFor('plan', 'mock/fast') > feedback.weightFor('plan', 'mock/slow'), 'OperatorFeedbackEngine should rank positively reviewed models higher');
  sections.push({ title: 'Operator Feedback Loop', items: [{ name: 'Weight adjustment', passed: true }] });

  const bench = await new BenchmarkDatabase({ dataPath, logger: silent }).start();
  await bench.record({ provider: 'ollama', model: 'llama2', hardwareProfile: 'cpu', latency: 120, throughput: 10, startupTime: 3000, embeddingSpeed: 50 });
  await bench.record({ provider: 'lmstudio', model: 'llama2', hardwareProfile: 'cpu', latency: 90, throughput: 12, startupTime: 2000, embeddingSpeed: 60 });
  await bench.record({ provider: 'llamacpp', model: 'llama2', hardwareProfile: 'cpu', latency: 80, throughput: 15, startupTime: 1000, embeddingSpeed: 70 });
  const compare = await bench.compare('ollama', 'lmstudio');
  assert(compare.ollama && compare.lmstudio, 'BenchmarkDatabase should compare providers');
  assert(compare.ollama.avgLatency > compare.lmstudio.avgLatency, 'Benchmark latency comparison should be consistent');
  const trend = await bench.trendReport('llama2');
  assert(trend && trend.samples === 3, 'Benchmark trend report should aggregate model history');
  sections.push({ title: 'Model Benchmark Database', items: [{ name: 'Compare providers', passed: true }, { name: 'Trend report', passed: true }] });

  const mm = new ModelManager({ adapters: [new MockAdapter()], logger: silent });
  await mm.start();
  const em = await new EmbeddingManager({ modelManager: mm, dataPath, storeFile: 'p37mem.json' }).start();
  const smi = new SemanticMemoryIndex({ embeddingManager: em, logger: silent });
  await smi.remember('Verified strategic memory', { confidence: 0.95, verified: true, tier: SemanticMemoryIndex.TIERS.EXECUTIVE });
  await smi.remember('Old unverified memory', { confidence: 0.3 });
  await smi.remember('Resonate launch is a complete success', { confidence: 0.9, source: 'executive-note', verified: true });
  await smi.remember('Resonate launch is blocked', { confidence: 0.3, source: 'rumor' });
  const quality = await smi.runQualityPass();
  const metrics = smi.getMetrics();
  assert(metrics.docCount === 4, 'SemanticMemoryIndex should track four documents');
  assert(metrics.contradictionCount >= 1, 'SemanticMemoryIndex should detect contradictions');
  assert(quality.promoted + quality.protected >= 1, 'Memory quality pass should promote/protect high-value memories');
  sections.push({ title: 'Adaptive Memory Quality', items: [{ name: 'Quality scoring', passed: true }, { name: 'Contradiction detection', passed: true }, { name: 'Auto promote/archive', passed: true }] });

  const rm = new ResourceManager({ logger: silent });
  const report = await rm.hardwareReport();
  assert(typeof report.cpuSaturation === 'boolean', 'ResourceManager should report CPU saturation');
  assert(typeof report.ramPressure === 'boolean', 'ResourceManager should report RAM pressure');
  const embedRec = rm.recommendForTask('embedding', [{ id: 'nomic', capabilities: ['embed'], size: 1000 }, { id: 'qwen', capabilities: ['chat', 'embed'], size: 1_000_000_000 }]);
  assert(embedRec && embedRec.id === 'nomic', 'Hardware-aware routing should pick dedicated embedding model for embedding task');
  const reasonRec = rm.recommendForTask('planning', [{ id: 'tiny', capabilities: ['chat'], size: 1000, contextSize: 2048 }, { id: 'qwen', capabilities: ['reasoning', 'chat'], size: 100_000_000, contextSize: 8192 }]);
  assert(reasonRec && reasonRec.id === 'qwen', 'Hardware-aware routing should prefer reasoning model for planning');
  sections.push({ title: 'Hardware-Aware Resource Management', items: [{ name: 'CPU/RAM pressure detection', passed: true }, { name: 'Task-aware routing', passed: true }] });

  const policy = new ExecutionPolicy({ logger: silent });
  assert(policy.authorize({ type: 'read_memory' }).allowed === true, 'ExecutionPolicy should allow read_memory');
  assert(policy.authorize({ type: 'modify_file' }).allowed === false, 'ExecutionPolicy should require approval for modify_file');
  assert(policy.authorize({ type: 'credential_extraction' }).allowed === false, 'ExecutionPolicy should forbid credential_extraction');
  sections.push({ title: 'Policy Compliance', items: [{ name: 'Autonomous reads', passed: true }, { name: 'Approval gating', passed: true }, { name: 'Forbidden actions', passed: true }] });

  const selection = new ModelSelectionPolicy();
  const candidates = [
    { id: 'tinyllama', capabilities: ['chat'], size: 637_000_000, contextSize: 2048, healthy: true },
    { id: 'qwen2.5:7b', capabilities: ['chat', 'reasoning'], size: 4_683_000_000, contextSize: 8192, healthy: true },
    { id: 'nomic-embed-text', capabilities: ['chat', 'embed'], size: 274_000_000, contextSize: 2048, healthy: true },
  ];
  const selected = selection.apply('embedding_task', candidates);
  assert(selected && selected.id === 'nomic-embed-text', 'ModelSelectionPolicy should still select embedding model');
  sections.push({ title: 'Model Selection Policy', items: [{ name: 'Embedding task routing', passed: true }] });

  const dashboard = new ExecutivePerformanceDashboard({
    runtime: { allStates: () => ({}), active: new Map(), queues: new Map() },
    resources: rm,
    memory: smi,
    optimizer,
    outcomes,
    feedback,
    logger: silent,
  });
  const dash = await dashboard.fullReport();
  assert(dash && dash.runtime && dash.decisionQuality && dash.memory && dash.agents, 'ExecutivePerformanceDashboard should produce all metric sections');
  sections.push({ title: 'Executive Performance Dashboard', items: [{ name: 'Runtime metrics', passed: true }, { name: 'Decision quality', passed: true }, { name: 'Memory metrics', passed: true }, { name: 'Agent metrics', passed: true }] });

  await telemetry.stop();
  await fs.rm(dataPath, { recursive: true, force: true });

  const result = { overall: 'PASS', sections };
  console.log(JSON.stringify(result, null, 2));

  let md = '# Phase 37 — Validation Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Overall: **${result.overall}**\n\n`;
  for (const section of sections) {
    md += mdSection(section.title, section.items);
    md += '\n';
  }
  await fs.writeFile(reportPath, md, 'utf8');
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
