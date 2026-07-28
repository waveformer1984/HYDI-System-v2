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

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function git(cwd, ...args) {
  const quoted = args.map((a) => (String(a).includes(' ') ? `"${a}"` : a));
  const { stdout } = await execAsync(`git ${quoted.join(' ')}`, { cwd });
  return stdout.trim();
}

async function run() {
  const start = Date.now();
  const dataPath = path.join(os.tmpdir(), `hydi-phase32-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const projectDir = path.join(dataPath, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  const transcript = [];
  function log(title, text) {
    transcript.push(`\n=== ${title} ===\n${text}`);
  }

  // Seed a real git repo.
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Project\n');
  await git(projectDir, 'init');
  await git(projectDir, '-c', 'user.email=test@hydi.local', '-c', 'user.name=Phase32', 'commit', '--allow-empty', '-m', 'initial');
  await git(projectDir, 'add', '.');
  await git(projectDir, '-c', 'user.email=test@hydi.local', '-c', 'user.name=Phase32', 'commit', '-m', 'initial readme');

  const bootStart = Date.now();
  const mode = new OperatorMode({ offline: true });
  const session = new OperatorSession({
    dataPath,
    mode,
    logger: silent,
    taskIntervalMs: 50,
    git: { cwd: projectDir, project: 'project', pollIntervalMs: 1000 },
    filesystem: { roots: { project: projectDir }, scanIntervalMs: 1000 },
  });
  await session.start();
  const bootTime = Date.now() - bootStart;

  // Sensor baseline + real work event.
  await sleep(1200);
  await fs.writeFile(path.join(projectDir, 'feature.md'), '# Feature\n');
  await git(projectDir, 'add', '.');
  await git(projectDir, '-c', 'user.email=test@hydi.local', '-c', 'user.name=Phase32', 'commit', '-m', 'add feature');
  await sleep(1200);

  const commands = [
    ['Morning briefing', 'good morning'],
    ['What changed', 'what changed since this morning'],
    ['Priorities', 'what should I focus on'],
    ['What deserves attention', 'what deserves my attention today'],
    ['Show risks', 'show me the risks'],
    ['Recommendations', 'recommend'],
    ['Autonomous capabilities', 'what can you do without me'],
    ['Create action from real event', 'do review feature commit'],
    ['Pending approvals', 'show approvals'],
    ['Approve action', null], // injected below
    ['Execution history', 'history'],
    ['Measure outcome', null], // injected below
    ['Learning dashboard', 'learning'],
    ['What did we learn', 'what did we learn'],
    ['Which recommendation failed', 'which recommendation turned out to be wrong'],
    ['Afternoon status', 'review status'],
    ['Business KPIs', 'kpis'],
    ['Measured learning', 'measured'],
    ['End of day', 'daily close'],
  ];

  let actionId = null;
  for (const [title, text] of commands) {
    let t = text;
    if (title === 'Approve action' && actionId) t = `approve ${actionId}`;
    if (title === 'Measure outcome' && actionId) t = `measure ${actionId} success`;
    if (!t) continue;
    const askStart = Date.now();
    const resp = await session.ask(t);
    const elapsed = Date.now() - askStart;
    log(`${title} (${elapsed}ms)`, resp.text);
    if (title === 'Create action from real event') {
      actionId = resp.text.match(/\((exec_[^)]+)\)/)?.[1];
    }
  }

  // Persistence: restart and resume.
  await session.destroy();
  const warmStart = Date.now();
  const session2 = new OperatorSession({
    dataPath,
    mode,
    logger: silent,
    taskIntervalMs: 50,
    git: { cwd: projectDir, project: 'project', pollIntervalMs: 1000 },
    filesystem: { roots: { project: projectDir }, scanIntervalMs: 1000 },
  });
  await session2.start();
  const warmTime = Date.now() - warmStart;
  const restartResp = await session2.ask('what did we learn');
  log(`Warm restart (${warmTime}ms)`, restartResp.text);

  const audit = session2.executionGateway.verifyAuditChain();
  log('Audit verification', JSON.stringify(audit, null, 2));

  const health = session2.healthCheck();
  log('Health check', JSON.stringify(health.checks));

  const perf = [
    `Cold boot: ${bootTime}ms`,
    `Warm restart: ${warmTime}ms`,
    `Total demo duration: ${Date.now() - start}ms`,
    `Memory heapUsed end: ${process.memoryUsage().heapUsed}`,
  ];
  log('Performance', perf.join('\n'));

  transcript.unshift(`ProtoForge Executive Workspace — Phase 32 Workflow Demonstration\nStarted: ${new Date(start).toISOString()}\n`);
  const transcriptPath = path.resolve(__dirname, '../reports/business-os/phase32-workspace-transcript.txt');
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.writeFile(transcriptPath, transcript.join('\n'), 'utf8');

  await session2.destroy();
  try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log(transcript.join('\n'));
  console.log(`\nTranscript saved to ${transcriptPath}`);
  process.exit(0);
}

run().catch((e) => {
  console.error('Demo failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
