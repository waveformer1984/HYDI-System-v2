'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../src/hydi-v3/OperatorSession');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

function divider(title) {
  return `\n=== ${title} ===`;
}

async function run() {
  const dataPath = path.join(os.tmpdir(), `hydi-phase29-demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });

  const session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
  await session.start();

  console.log(divider('Operator logs in and asks for a morning briefing'));
  const briefing = await session.ask('good morning');
  console.log(briefing.text);

  console.log(divider('Operator asks what to work on'));
  const focus = await session.ask('what should I focus on');
  console.log(focus.text);

  console.log(divider('Operator creates a tracked action in plain English'));
  const create = await session.ask('do follow up with enterprise lead');
  console.log(create.text);
  const actionId = create.text.match(/\((exec_[^)]+)\)/)?.[1];
  const recId = create.action?.recommendationId;
  console.log(`  -> action id: ${actionId}, recommendation id: ${recId}`);

  console.log(divider('Operator reviews pending approvals'));
  const approvals = await session.ask('show approvals');
  console.log(approvals.text);

  console.log(divider('Operator approves the action'));
  const approve = await session.ask(`approve ${actionId}`);
  console.log(approve.text);

  console.log(divider('Operator checks execution history'));
  const history = await session.ask('history');
  console.log(history.text);

  console.log(divider('Operator measures the business outcome'));
  const measure = await session.ask(`measure ${actionId} success`);
  console.log(measure.text);

  console.log(divider('Operator adds a quantitative revenue measurement'));
  const revenue = await session.ask('measure revenue +12500');
  console.log(revenue.text);

  console.log(divider('Operator checks learning dashboard'));
  const learning = await session.ask('learning');
  console.log(learning.text);

  console.log(divider('Operator checks what is still awaiting measurement'));
  const awaiting = await session.ask('awaiting measurements');
  console.log(awaiting.text);

  console.log(divider('Restarting the system to verify persistence'));
  await session.stop?.() || await session.destroy?.();

  const restarted = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
  await restarted.start();

  const restored = restarted.recommendationTracker.getRecommendation(recId);
  console.log(`  -> restored recommendation ${recId}: ${restored.status} / ${restored.observedOutcome ? restored.observedOutcome.type : 'no outcome'}`);
  console.log(`  -> outcomes recorded: ${restarted.decisionOutcomeStore.getOutcomes().length}`);

  const metrics = restarted.learningMetrics.computeMetrics();
  console.log(`  -> learning metrics: ${metrics.completed} completed, ${metrics.successful} successful, ${metrics.failed} failed`);

  await restarted.destroy();
  try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log(divider('Phase 29 closed-loop demonstration complete'));
}

run().catch((e) => {
  console.error('Demo failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
