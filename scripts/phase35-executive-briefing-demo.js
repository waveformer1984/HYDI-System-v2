#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const OperatorSession = require('../src/hydi-v3/OperatorSession');
const OperatorMode = require('../src/hydi-v3/OperatorMode');
const BaseAdapter = require('../src/hydi-v3/BaseAdapter');
const SemanticMemoryIndex = require('../src/hydi-v3/SemanticMemoryIndex');
const KnowledgePipeline = require('../src/hydi-v3/KnowledgePipeline');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

class MockAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'mock://local' });
    this.name = 'mock-local';
  }

  async health() { return { ok: true, status: 'ok', note: 'Mock local AI for demonstration' }; }
  async listModels() { return [{ id: 'mock/local-llm', name: 'mock/local-llm', provider: 'mock', capabilities: ['chat', 'embed', 'vision'] }]; }
  async chat(messages) {
    const prompt = messages.map((m) => m.content).join('\n');
    if (prompt.includes('intent-extraction')) {
      if (prompt.toLowerCase().includes('briefing')) return { ok: true, text: '{"intent":"good-morning","args":{}}' };
      if (prompt.toLowerCase().includes('recommend')) return { ok: true, text: '{"intent":"recommendations","args":{}}' };
      return { ok: true, text: '{"intent":"status","args":{}}' };
    }
    return { ok: true, text: 'Mock local model response for executive analysis.' };
  }
  async complete(prompt) { return { ok: true, text: `Mock summary: ${prompt.slice(0, 60)}...` }; }
  async embed(text) {
    const vector = Array.from({ length: 8 }, (_, i) => (String(text).length + i) % 7 / 10);
    return { ok: true, vector };
  }
  async vision(imageInput, prompt = '') { return { ok: true, text: `Mock vision: ${imageInput ? imageInput.length : 0} bytes. ${prompt}` }; }
}

async function git(cwd, ...args) {
  const quoted = args.map((a) => (String(a).includes(' ') ? `"${a}"` : a));
  const { stdout } = await execAsync(`git ${quoted.join(' ')}`, { cwd });
  return stdout.trim();
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-p35-briefing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const projectDir = path.join(dataPath, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  await fs.writeFile(path.join(projectDir, 'README.md'), '# Resonate\nProduct launch Q1.\n');
  await fs.writeFile(path.join(projectDir, 'architecture.md'), '# Architecture\nMonolithic Node runtime, local AI layer.\n');
  await git(projectDir, 'init');
  await git(projectDir, '-c', 'user.email=mock@hydi.local', '-c', 'user.name=Phase35', 'commit', '--allow-empty', '-m', 'initial');
  await git(projectDir, 'add', '.');
  await git(projectDir, '-c', 'user.email=mock@hydi.local', '-c', 'user.name=Phase35', 'commit', '-m', 'resonate project docs');

  const session = new OperatorSession({
    dataPath,
    mode: new OperatorMode({ offline: true }),
    logger: silent,
    taskIntervalMs: 50,
    localAI: { adapters: [new MockAdapter()] },
    git: { cwd: projectDir, project: 'project', pollIntervalMs: 1000 },
    filesystem: { roots: { project: projectDir }, scanIntervalMs: 1000 },
  });
  await session.start();

  const semantic = new SemanticMemoryIndex({ embeddingManager: session.embeddingManager, businessMemory: session.memory, logger: silent });
  await semantic.remember('Resonate product launch in Q1', { tier: SemanticMemoryIndex.TIERS.EXECUTIVE, importance: 2 });
  await semantic.remember('Manufacturing printer needs calibration', { tier: SemanticMemoryIndex.TIERS.WORKING, importance: 1 });

  const knowledge = new KnowledgePipeline({ embeddingManager: session.embeddingManager, modelRouter: session.modelRouter, logger: silent });
  await knowledge.ingestDirectory(projectDir);

  // 1. Operator asks for an executive briefing.
  console.log('\n=== USER: "Prepare today\'s executive briefing" ===\n');
  const briefing = await session.ask("Prepare today's executive briefing");
  console.log(briefing.text.slice(0, 1200));

  // 2. HYDI retrieves semantic memories for context.
  const relevant = await semantic.recall('executive briefing', { limit: 3 });
  console.log('\n=== Relevant semantic memories ===');
  for (const r of relevant) console.log(`- ${r.text.slice(0, 80)} (score ${r.score.toFixed(3)})`);

  // 3. HYDI analyzes active projects and generates recommendations.
  const recommendation = await session.ask('recommend');
  console.log('\n=== Recommendation ===');
  console.log(recommendation.text.slice(0, 600));

  // 4. Create a recommended action and route through ExecutionGateway.
  const action = await session.ask('do review resonate architecture');
  console.log('\n=== Action ===');
  console.log(action.text.slice(0, 600));
  const actionId = action.text.match(/\((exec_[^)]+)\)/)?.[1];

  // 5. Approval and execution.
  if (actionId) {
    const approval = await session.ask(`approve ${actionId}`);
    console.log('\n=== Approval / Execution ===');
    console.log(approval.text);
  }

  // 6. Record outcome and learning.
  await session.ask(`measure ${actionId} success`);

  // 7. Audit verification.
  const audit = session.executionGateway.verifyAuditChain();
  console.log('\n=== Audit chain ===');
  console.log(JSON.stringify(audit, null, 2));

  // 8. Model router log (routing decisions).
  console.log('\n=== Model routing log ===');
  for (const entry of session.modelRouter.recentLog(10)) console.log(`- ${entry.task} -> ${entry.model} (${entry.ms || 0}ms)`);

  await session.destroy();
  await fs.rm(dataPath, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('Demo failed:', e instanceof Error ? e.message : String(e));
  console.error(e.stack);
  process.exit(1);
});
