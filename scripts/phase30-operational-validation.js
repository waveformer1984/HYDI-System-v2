#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../src/hydi-v3/OperatorSession');
const OperatorMode = require('../src/hydi-v3/OperatorMode');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

function now() { return Date.now(); }
function mem() { return process.memoryUsage(); }

function actionIdFrom(text) {
  const m = text.match(/\((exec_[^)]+)\)/);
  return m ? m[1] : null;
}

function recIdFrom(text) {
  const m = text.match(/\(recommendation (rec_[^)]+)\)/);
  return m ? m[1] : null;
}

function firstLine(text) {
  return String(text || '').split('\n')[0];
}

async function run() {
  const start = now();
  const dataPath = path.join(os.tmpdir(), `hydi-phase30-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });

  const report = {
    phase: 30,
    startedAt: new Date(start).toISOString(),
    dataPath,
    offline: true,
    evidence: {
      boot: [],
      day: [],
      conversation: [],
      failures: [],
      restart: [],
      trust: [],
      memory: [],
    },
  };

  function note(section, label, ok, detail) {
    report.evidence[section].push({ at: now(), label, ok, detail: firstLine(detail) });
  }

  report.evidence.memory.push({ at: now(), label: 'baseline', ...mem() });

  const mode = new OperatorMode({ offline: true });
  let session = new OperatorSession({ dataPath, mode, logger: silent, taskIntervalMs: 50 });

  // Boot
  await session.start();
  const bootHealth = session.healthCheck();
  note('boot', 'cold boot health', bootHealth.ok, JSON.stringify(bootHealth.checks));
  note('boot', 'offline mode installed', mode.active.includes('offline'), mode.describe());

  // ---- Scripted day ----
  const day = [
    'good morning',
    'what should I focus on',
    'do follow up with the enterprise lead',
    'do draft proposal for summit',
    'show approvals',
    null, // approve inserted below
    null,
    'history',
    null, // measure
    null,
    'measure revenue +12500',
    'learning',
    'review status',
    'daily close',
  ];

  const responses = {};

  for (let i = 0; i < day.length; i++) {
    const cmd = day[i];
    if (cmd === null) continue;
    const before = now();
    const resp = await session.ask(cmd);
    const elapsed = now() - before;
    responses[cmd] = resp;
    note('day', cmd, true, `${resp.text.slice(0, 120)} (${elapsed}ms)`);
    if (cmd.startsWith('do ')) {
      const actionId = actionIdFrom(resp.text);
      const recId = recIdFrom(resp.text);
      if (actionId) {
        // schedule approve two steps later for each creation
        const approveIndex = day.indexOf(null, i + 1);
        if (approveIndex !== -1) day[approveIndex] = `approve ${actionId}`;
        // schedule measure after approvals
        for (let j = approveIndex + 1; j < day.length; j++) {
          if (day[j] === null) { day[j] = `measure ${actionId} ${cmd.includes('enterprise') ? 'success' : 'partial'}`; break; }
        }
        responses[actionId] = { recId, intent: resp.intent };
      }
    }
    report.evidence.memory.push({ at: now(), label: `after ${cmd}`, ...mem() });
  }

  // ---- Natural conversation audit ----
  const phrases = [
    'What deserves my attention today?',
    "What's blocking progress?",
    'What did we learn yesterday?',
    'Which recommendation turned out to be wrong?',
    'Show me risky assumptions.',
    'Why are you recommending this?',
    'What changed since this morning?',
    'What would you do next if I left for the day?',
  ];

  for (const phrase of phrases) {
    try {
      const resp = await session.ask(phrase);
      const useful = resp.text && resp.text.length > 0 && !resp.text.toLowerCase().includes('did not understand');
      note('conversation', phrase, useful, resp.text.slice(0, 200));
    } catch (e) {
      note('conversation', phrase, false, e instanceof Error ? e.message : String(e));
    }
    report.evidence.memory.push({ at: now(), label: 'conversation', ...mem() });
  }

  // ---- Trust baseline ----
  const trustBefore = session.learningMetrics.computeMetrics();
  note('trust', 'trust baseline', true, `accuracy ${trustBefore.predictionAccuracy}, success ${trustBefore.recommendationSuccessRate}, confidence ${trustBefore.averageConfidence}`);

  // ---- Failure injection ----

  // 1. Duplicate measurement (ignored)
  const firstActionId = Object.keys(responses).find((k) => k.startsWith('exec_'));
  if (firstActionId) {
    const dup = await session.ask(`measure ${firstActionId} success`);
    note('failures', 'duplicate measurement ignored', dup.text.toLowerCase().includes('already') || dup.text.toLowerCase().includes('recorded'), dup.text.slice(0, 200));
  }

  // 2. Conflicting measurement (ignored)
  if (firstActionId) {
    const conflict = await session.ask(`measure ${firstActionId} failed`);
    note('failures', 'conflicting measurement ignored', !conflict.text.toLowerCase().includes('failed') || conflict.text.toLowerCase().includes('already'), conflict.text.slice(0, 200));
  }

  // 3. Malformed evidence (handled)
  try {
    session.evidenceEngine.addEvidence('rec_nonexistent', { source: 'test' });
    note('failures', 'malformed evidence', false, 'did not throw');
  } catch (e) {
    note('failures', 'malformed evidence rejected', true, e instanceof Error ? e.message : String(e));
  }

  // 4. Offline refusal of network action
  try {
    const offline = await session.executionGateway.execute({ type: 'send-email', params: { to: 'x' }, requestingAgent: 'test' });
    note('failures', 'offline refusal', false, `executed ${JSON.stringify(offline)}`);
  } catch (e) {
    note('failures', 'offline refusal', true, e instanceof Error ? e.message : String(e));
  }

  // 5. Corrupt memory file recovery
  const memPath = path.join(dataPath, 'business-memory.json');
  try {
    await fs.writeFile(memPath, 'not-json{');
  } catch (e) {
    note('failures', 'corrupt memory file write', false, e instanceof Error ? e.message : String(e));
  }

  // ---- Restart (warm) ----
  const uptime = now() - start;
  note('restart', 'uptime before restart', true, `${(uptime / 1000).toFixed(1)}s`);

  await session.destroy();
  session = null;

  const session2 = new OperatorSession({ dataPath, mode, logger: silent, taskIntervalMs: 50 });
  await session2.start();
  const warmHealth = session2.healthCheck();
  note('restart', 'warm restart health', warmHealth.ok, JSON.stringify(warmHealth.checks));

  const afterRestart = await session2.ask('good morning');
  note('restart', 'good morning after restart', afterRestart.text.length > 0, afterRestart.text.slice(0, 200));

  const auditChain = session2.executionGateway.verifyAuditChain();
  note('restart', 'audit chain intact', auditChain.ok, JSON.stringify(auditChain.checks || auditChain));

  const trustAfter = session2.learningMetrics.computeMetrics();
  note('trust', 'trust after restart', true, `completed ${trustAfter.completed}, successful ${trustAfter.successful}, confidence ${trustAfter.averageConfidence}`);

  report.evidence.memory.push({ at: now(), label: 'after restart', ...mem() });

  // ---- Corrupt memory recovery observation ----
  try {
    await fs.access(memPath);
    const repaired = await fs.readFile(memPath, 'utf8');
    note('failures', 'corrupt memory recovery', repaired.startsWith('{'), `starts: ${repaired.slice(0, 40)}`);
  } catch (e) {
    note('failures', 'corrupt memory recovery', false, e instanceof Error ? e.message : String(e));
  }

  // ---- Final ----
  const final = now();
  report.endedAt = new Date(final).toISOString();
  report.durationSeconds = ((final - start) / 1000).toFixed(1);
  const finalMem = mem();
  report.heapGrowthBytes = finalMem.heapUsed - report.evidence.memory[0].heapUsed;
  report.commandsIssued = report.evidence.day.length + report.evidence.conversation.length;

  await session2.destroy();

  // Cleanup temp data
  try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run().catch((e) => {
  console.error('Validation harness failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
