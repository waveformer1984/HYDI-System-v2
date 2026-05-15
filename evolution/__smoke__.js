#!/usr/bin/env node
/**
 * Smoke tests for the ProtoForge Next Evolution modules.
 * Run with:  node evolution/__smoke__.js
 *
 * Six tests — no test framework needed, no network calls.
 * Exit 0 = all pass.  Exit 1 = at least one failure.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => { console.log(`  PASS  ${name}`); passed++; })
        .catch(err => { console.error(`  FAIL  ${name}\n        ${err.message}`); failed++; });
    }
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
  return Promise.resolve();
}

// ─── 1. Nexus: agent registration ────────────────────────────────────────────

const { ProtoForgeNexus } = require('./nexus');

const nexus1 = new ProtoForgeNexus();

test('Nexus: agent registers and shows as online', () => {
  nexus1.register('heidi', ['chat', 'goals']);
  const status = nexus1.getAgentStatus('heidi');
  assert.strictEqual(status.name, 'heidi');
  assert.strictEqual(status.status, 'online');
  assert.ok(status.capabilities.includes('chat'));
});

// ─── 2. Nexus: message routing ────────────────────────────────────────────────

test('Nexus: send routes message and logs it', () => {
  nexus1.register('ursula', ['health']);
  let received = null;
  nexus1.on('message:ursula', msg => { received = msg; });

  nexus1.send('heidi', 'ursula', 'health:ping', { ts: 1 });

  assert.ok(received, 'message:ursula event not fired');
  assert.strictEqual(received.from, 'heidi');
  assert.strictEqual(received.action, 'health:ping');
  assert.strictEqual(nexus1.messageLog.length, 1);
});

// ─── 3. Heidi Goals: goal creation (no-brain path) ───────────────────────────

const HeidiGoalEngine = require('./heidi-goals');

async function testGoalCreation() {
  return test('Heidi Goals: creates goal with fallback tasks when brain absent', async () => {
    const engine = new HeidiGoalEngine(null, null, {
      storePath: path.join(os.tmpdir(), `heidi_smoke_${Date.now()}.json`),
    });
    await engine.initialize();

    const goal = await engine.addGoal('Write the monitoring dashboard');
    assert.ok(goal.id.startsWith('goal_'));
    assert.strictEqual(goal.status, 'active');
    assert.ok(goal.tasks.length >= 3, `expected >= 3 tasks, got ${goal.tasks.length}`);
    assert.strictEqual(goal.tasks[0].status, 'pending');
  });
}

// ─── 4. Heidi Goals: task completion ──────────────────────────────────────────

async function testTaskCompletion() {
  return test('Heidi Goals: completing all tasks marks goal done', async () => {
    const engine = new HeidiGoalEngine(null, null, {
      storePath: path.join(os.tmpdir(), `heidi_smoke2_${Date.now()}.json`),
    });
    await engine.initialize();

    const goal = await engine.addGoal('Deploy passive services');
    const tasks = goal.tasks;
    for (const t of tasks) {
      engine.completeTask(goal.id, t.id, { ok: true });
    }
    const updated = engine.getGoal(goal.id);
    assert.strictEqual(updated.status, 'completed');
  });
}

// ─── 5. Ursula Forecast: record + trend ───────────────────────────────────────

const UrsulaForecast = require('./ursula-forecast');

test('Ursula Forecast: records snapshots and computes trend', () => {
  const ursula = new UrsulaForecast();

  // Simulate rising job failures over 20 minutes
  const now = Date.now();
  for (let i = 0; i < 20; i++) {
    ursula.snapshots.push({ ts: now - (20 - i) * 60_000, metrics: { jobsFailed: i } });
  }

  const { trend, slope } = ursula.trendFor('jobsFailed', 30);
  assert.strictEqual(trend, 'degrading', `expected degrading, got ${trend}`);
  assert.ok(slope > 0, `slope should be positive, got ${slope}`);
});

// ─── 6. Ursula Forecast: proactive alert ─────────────────────────────────────

test('Ursula Forecast: emits proactive alert before threshold breach', () => {
  const ursula = new UrsulaForecast();

  // jobsFailed threshold: warn=5, critical=20
  // Seed with a rising trend that will hit warn within 6h
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    ursula.snapshots.push({ ts: now - (30 - i) * 60_000, metrics: { jobsFailed: i * 0.15 } });
  }

  const proactive = ursula.getProactiveAlerts(6);
  const jobsAlert = proactive.find(a => a.metric === 'jobsFailed');
  assert.ok(jobsAlert, 'expected a proactive alert for jobsFailed');
  // Briefing should mention FORECAST
  const briefing = ursula.generateBriefing();
  assert.ok(briefing.includes('FORECAST'), 'briefing should include FORECAST label');
});

// ─── Auth guard warning (informational) ──────────────────────────────────────

if (!process.env.NEXUS_OPERATOR_SECRET) {
  console.warn('\n  [WARN] NEXUS_OPERATOR_SECRET not set — operator-api auth guard will reject all requests');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

Promise.all([testGoalCreation(), testTaskCompletion()]).then(() => {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
