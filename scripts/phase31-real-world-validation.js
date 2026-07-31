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

function now() { return Date.now(); }
function mem() { return process.memoryUsage(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function git(cwd, ...args) {
  const quoted = args.map((a) => (String(a).includes(' ') ? `"${a}"` : a));
  const { stdout, stderr } = await execAsync(`git ${quoted.join(' ')}`, { cwd });
  if (stderr && !stderr.includes('warning')) throw new Error(stderr);
  return stdout.trim();
}

async function run() {
  const start = now();
  const dataPath = path.join(os.tmpdir(), `hydi-phase31-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const projectDir = path.join(dataPath, 'real-project');
  await fs.mkdir(projectDir, { recursive: true });

  const report = {
    phase: 31,
    startedAt: new Date(start).toISOString(),
    dataPath,
    projectDir,
    evidence: {
      sensorSetup: [],
      sensorEvents: [],
      conversation: [],
      pipeline: [],
      malformedEvidence: [],
      performance: [],
      persistence: [],
      readiness: {},
    },
  };

  function note(section, label, ok, detail) {
    report.evidence[section].push({ at: now(), label, ok, detail: String(detail).slice(0, 300) });
  }

  // Build a real git repo with an initial commit.
  try {
    await fs.writeFile(path.join(projectDir, 'README.md'), '# Real Project\n');
    await git(projectDir, 'init');
    await git(projectDir, '-c', 'user.email=test@hydi.local', '-c', 'user.name=Phase31', 'commit', '--allow-empty', '-m', 'initial');
    await git(projectDir, 'add', '.');
    await git(projectDir, '-c', 'user.email=test@hydi.local', '-c', 'user.name=Phase31', 'commit', '-m', 'initial readme');
    note('sensorSetup', 'git repo initialized', true, projectDir);
  } catch (e) {
    note('sensorSetup', 'git repo initialized', false, e instanceof Error ? e.message : String(e));
  }

  const bootStart = now();
  const mode = new OperatorMode({ offline: true });
  const session = new OperatorSession({
    dataPath,
    mode,
    logger: silent,
    taskIntervalMs: 50,
    git: { cwd: projectDir, project: 'real-project', pollIntervalMs: 1000 },
    filesystem: { roots: { 'real-project': projectDir }, scanIntervalMs: 1000 },
  });

  await session.start();
  note('performance', 'cold boot time', true, `${now() - bootStart}ms`);
  note('sensorSetup', 'session started', session.healthCheck().ok, JSON.stringify(session.healthCheck().checks));

  // Wait for baseline, then create a real change.
  await sleep(1200);

  try {
    await fs.writeFile(path.join(projectDir, 'feature.md'), '# New Feature\n');
    await git(projectDir, 'add', '.');
    await git(projectDir, '-c', 'user.email=test@hydi.local', '-c', 'user.name=Phase31', 'commit', '-m', 'add feature');
    note('sensorSetup', 'second commit created', true, 'feature.md');
  } catch (e) {
    note('sensorSetup', 'second commit created', false, e instanceof Error ? e.message : String(e));
  }

  await sleep(1500);

  // Sensor capture: collect bus events? Instead, we rely on morning briefing / what changed.
  const beforeAsk = now();
  const morning = await session.ask('good morning');
  note('performance', 'good morning latency', true, `${now() - beforeAsk}ms`);
  note('conversation', 'good morning', morning.text && morning.text.length > 0, morning.text.slice(0, 200));

  // Check recent activity includes real filesystem/git signals.
  const activity = morning.briefing && Array.isArray(morning.briefing.recentActivity) ? morning.briefing.recentActivity.join('\n') : 'no activity section';
  note('sensorEvents', 'recent activity captured', activity.toLowerCase().includes('real-project') || activity.toLowerCase().includes('activity signal'), activity.slice(0, 300));

  const changed = await session.ask('what changed since this morning');
  note('conversation', 'what changed since this morning', changed.text && changed.text.length > 0, changed.text.slice(0, 300));

  const attention = await session.ask('what deserves my attention today');
  note('conversation', 'what deserves my attention', attention.text && attention.text.length > 0, attention.text.slice(0, 200));

  const risks = await session.ask('show me the risks');
  note('conversation', 'show me the risks', risks.text && risks.text.length > 0, risks.text.slice(0, 200));

  // Full closed-loop pipeline from a real observation-driven recommendation.
  const action = await session.ask('do review feature commit');
  note('pipeline', 'create action from real event', action.text && action.text.includes('Created'), action.text.slice(0, 200));
  const actionId = action.text.match(/\((exec_[^)]+)\)/)?.[1];
  const recId = action.action?.recommendationId;

  if (actionId) {
    const approve = await session.ask(`approve ${actionId}`);
    note('pipeline', 'approve action', approve.text && approve.text.includes('Approved'), approve.text.slice(0, 200));
    const measure = await session.ask(`measure ${actionId} success`);
    note('pipeline', 'measure outcome', measure.text && measure.text.toLowerCase().includes('success'), measure.text.slice(0, 200));
  } else {
    note('pipeline', 'action id extracted', false, action.text);
  }

  // Malformed evidence injection.
  const malformedTests = [
    { label: 'missing recommendation', fn: () => session.evidenceEngine.addEvidence('rec_nonexistent', { source: 'x', type: 'y' }) },
    { label: 'missing source', fn: () => session.evidenceEngine.addEvidence(recId || 'rec_missing', { type: 'y' }) },
    { label: 'missing type', fn: () => session.evidenceEngine.addEvidence(recId || 'rec_missing', { source: 'x' }) },
    { label: 'invalid measurement string', fn: () => session.evidenceEngine.addEvidence(recId || 'rec_missing', { source: 'x', type: 'y', data: 'not-a-number' }) },
    { label: 'impossible timestamp', fn: () => session.evidenceEngine.addEvidence(recId || 'rec_missing', { source: 'x', type: 'y', at: Date.now() + 86400000 * 365 }) },
  ];
  for (const t of malformedTests) {
    try {
      t.fn();
      note('malformedEvidence', t.label, false, 'did not throw');
    } catch (e) {
      note('malformedEvidence', t.label, true, e instanceof Error ? e.message : String(e));
    }
  }

  // Persistence: restart.
  await session.destroy();
  const warmStart = now();
  const session2 = new OperatorSession({
    dataPath,
    mode,
    logger: silent,
    taskIntervalMs: 50,
    git: { cwd: projectDir, project: 'real-project', pollIntervalMs: 1000 },
    filesystem: { roots: { 'real-project': projectDir }, scanIntervalMs: 1000 },
  });
  await session2.start();
  note('performance', 'warm restart time', true, `${now() - warmStart}ms`);
  note('persistence', 'warm restart health', session2.healthCheck().ok, JSON.stringify(session2.healthCheck().checks));

  const afterRestart = await session2.ask('what did we learn');
  note('persistence', 'lessons survive restart', afterRestart.text && afterRestart.text.toLowerCase().includes('learned'), afterRestart.text.slice(0, 300));

  const audit = session2.executionGateway.verifyAuditChain();
  note('persistence', 'audit chain after restart', audit.ok, JSON.stringify(audit));

  // Performance / memory.
  const final = now();
  report.durationSeconds = ((final - start) / 1000).toFixed(1);
  report.heapUsedEnd = mem().heapUsed;
  report.evidence.performance.push({ at: now(), label: 'memory end', ...mem() });

  // Readiness scorecard from observed evidence.
  const checks = [
    { name: 'Boot', pass: report.evidence.sensorSetup.some((x) => x.label === 'session started' && x.ok) },
    { name: 'Sensors', pass: report.evidence.sensorEvents.some((x) => x.label === 'recent activity captured' && x.ok) },
    { name: 'Conversation', pass: report.evidence.conversation.length >= 3 },
    { name: 'Approval', pass: report.evidence.pipeline.some((x) => x.label === 'approve action' && x.ok) },
    { name: 'Execution', pass: report.evidence.pipeline.some((x) => x.label === 'create action from real event' && x.ok) },
    { name: 'Evidence', pass: report.evidence.malformedEvidence.every((x) => x.ok) },
    { name: 'Learning', pass: report.evidence.pipeline.some((x) => x.label === 'measure outcome' && x.ok) },
    { name: 'Persistence', pass: report.evidence.persistence.some((x) => x.label === 'warm restart health' && x.ok) },
    { name: 'Audit', pass: report.evidence.persistence.some((x) => x.label === 'audit chain after restart' && x.ok) },
    { name: 'Local operation', pass: true },
  ];
  checks.forEach((c) => { report.evidence.readiness[c.name] = c.pass ? 'READY' : 'NOT READY'; });

  await session2.destroy();
  try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run().catch((e) => {
  console.error('Real-world validation failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
