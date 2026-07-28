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

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

async function git(cwd, ...args) {
  const quoted = args.map((a) => (String(a).includes(' ') ? `"${a}"` : a));
  const { stdout } = await execAsync(`git ${quoted.join(' ')}`, { cwd });
  return stdout.trim();
}

class MockLocalAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'mock://local', timeoutMs: 100 });
    this.name = 'mock-local';
    this.modelId = 'mock/local-llm';
  }

  async health() {
    return { ok: true, status: 'ok', note: 'Mock local AI for demonstration' };
  }

  async listModels() {
    return [{ id: this.modelId, name: this.modelId, provider: 'mock', capabilities: ['chat', 'embed', 'vision'] }];
  }

  async chat(messages) {
    const prompt = messages.map((m) => m.content).join('\n');
    if (prompt.includes('intent-extraction')) {
      if (prompt.toLowerCase().includes('focus')) return { ok: true, text: '{"intent":"focus","args":{"text":"What should I focus on"}}' };
      if (prompt.toLowerCase().includes('approval')) return { ok: true, text: '{"intent":"approvals","args":{}}' };
      return { ok: true, text: '{"intent":"status","args":{}}' };
    }
    return { ok: true, text: 'Mock local model response: I can summarize, plan, and review code without leaving this machine.' };
  }

  async complete(prompt) {
    return { ok: true, text: `Mock summary: ${prompt.slice(0, 60)}...` };
  }

  async embed(text) {
    // Deterministic 8-dim vector for demo so cosine is meaningful-ish.
    const vector = Array.from({ length: 8 }, (_, i) => (text.length + i) % 7 / 10);
    return { ok: true, vector };
  }

  async vision(imageInput, prompt = '') {
    return { ok: true, text: `Mock vision: observed ${imageInput ? imageInput.length : 0} bytes. ${prompt}` };
  }
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-phase34-${now()}-${Math.random().toString(36).slice(2)}`);
  const projectDir = path.join(dataPath, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  await fs.writeFile(path.join(projectDir, 'README.md'), '# AI Project\n');
  await git(projectDir, 'init');
  await git(projectDir, '-c', 'user.email=mock@hydi.local', '-c', 'user.name=Phase34', 'commit', '--allow-empty', '-m', 'initial');
  await git(projectDir, 'add', '.');
  await git(projectDir, '-c', 'user.email=mock@hydi.local', '-c', 'user.name=Phase34', 'commit', '-m', 'initial readme');

  const bootStart = now();
  const session = new OperatorSession({
    dataPath,
    mode: new OperatorMode({ offline: true }),
    logger: silent,
    taskIntervalMs: 50,
    localAI: { adapters: [new MockLocalAdapter()] },
    git: { cwd: projectDir, project: 'project', pollIntervalMs: 1000 },
    filesystem: { roots: { project: projectDir }, scanIntervalMs: 1000 },
  });
  await session.start();
  console.log(`Boot time: ${now() - bootStart}ms`);
  console.log('Model discovery:', JSON.stringify(session.modelStartupReport, null, 2));

  await sleep(1200);
  await fs.writeFile(path.join(projectDir, 'feature.md'), '# Local AI Feature\n');
  await git(projectDir, 'add', '.');
  await git(projectDir, '-c', 'user.email=mock@hydi.local', '-c', 'user.name=Phase34', 'commit', '-m', 'add local ai feature');
  await sleep(1200);

  // Demonstrate the local-AI-driven executive pipeline.
  const steps = [
    { title: 'Operator asks for focus', cmd: 'What should I focus on today?' },
    { title: 'Operator asks about risks', cmd: 'show me the risks' },
    { title: 'Operator asks for learning', cmd: 'what did we learn' },
    { title: 'Operator requests action', cmd: 'do review local ai feature' },
    { title: 'Operator approves', cmd: null }, // injected
    { title: 'Operator measures outcome', cmd: null }, // injected
    { title: 'Operator closes day', cmd: 'daily close' },
  ];

  let actionId = null;
  for (const step of steps) {
    let cmd = step.cmd;
    if (step.title === 'Operator approves') cmd = `approve ${actionId}`;
    if (step.title === 'Operator measures outcome') cmd = `measure ${actionId} success`;
    if (!cmd) continue;
    const askStart = now();
    const res = await session.ask(cmd);
    console.log(`\n=== ${step.title} (${now() - askStart}ms) ===`);
    console.log(res.text.slice(0, 500));
    if (step.title === 'Operator requests action') {
      actionId = res.text.match(/\((exec_[^)]+)\)/)?.[1];
    }
  }

  // Demonstrate model-router direct capabilities (RAG, summarize, plan, code review).
  console.log('\n=== Direct Model Router Demonstrations ===');
  const rag = await session.modelRouter.ragAnswer('What is the project status?', ['Project is active.', 'No risks.']);
  console.log('RAG result:', rag.text.slice(0, 200), `(model: ${rag.usedModel})`);
  const summary = await session.modelRouter.summarize('Meeting notes: launch next week, fix printer, update revenue.');
  console.log('Summary:', summary.text.slice(0, 200), `(model: ${summary.usedModel})`);
  const plan = await session.modelRouter.plan('Prepare for product launch.');
  console.log('Plan:', plan.text.slice(0, 200), `(model: ${plan.usedModel})`);

  // Demonstrate local embeddings and semantic memory.
  await session.embeddingManager.addDocument('Resonate product launch', { source: 'memory' });
  await session.embeddingManager.addDocument('Fix printer hardware', { source: 'memory' });
  const similar = await session.embeddingManager.search('launch preparation', 2);
  console.log('\nSemantic search top result:', similar[0]?.text, `(score: ${similar[0]?.score.toFixed(3)})`);

  // Verify audit and learning.
  const audit = session.executionGateway.verifyAuditChain();
  console.log('\nAudit chain:', JSON.stringify(audit));
  const learning = await session.ask('what did we learn');
  console.log('\nLearning after execution:', learning.text.slice(0, 200));

  console.log('\nModel router log:', session.modelRouter.recentLog(10).map((l) => `${l.task} -> ${l.model}`).join(', '));

  await session.destroy();
  try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

main().catch((e) => {
  console.error('Demo failed:', e instanceof Error ? e.message : String(e));
  console.error(e.stack);
  process.exit(1);
});
