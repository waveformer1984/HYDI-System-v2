/*
 * Revenue Autopilot Tick — the catch-up cadence for the durable revenue
 * mission.
 *
 * The revenue autopilot (lib/revenue/revenue-autopilot.js) only advances
 * when someone calls advance() — a chat message, the API, or the Stripe
 * webhook fast-path. That means a human completing a boundary at 2am
 * (paying a checkout, approving an opportunity, configuring a webhook
 * secret) would leave the mission parked until the next user message.
 *
 * This module closes the loop the other direction: on a fixed cadence it
 *   1. runs the human-action sync sweep (detect → seed → verify → resume
 *      satisfied goals), then
 *   2. calls advance() so any goal whose prerequisites resolved continues
 *      from its durable stage — checkout → payment → execute → reconcile.
 *
 * It is deliberately thin: all stage logic, boundary classification, and
 * proof semantics live in the autopilot and the human-action protocol.
 * This file adds cadence, nothing else.
 *
 * Runs as a standalone boot module via `npx tsx` (see boot.config.json's
 * "revenue-autopilot-tick" entry), same convention as job-executor-poller.
 * Environment is provided by the boot supervisor.
 */

import { getGoalSystem } from '../lib/heidi/GoalSystem';
import { JobManager } from '../lib/revenue/JobManager';
import { HumanActionService, syncHumanActions } from '../lib/human-actions';
import { advance } from '../lib/revenue/revenue-autopilot';
// CJS module — imported via interop, same convention as the autopilot.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appRealization = require('../lib/realization/app-realization.js');

const TICK_INTERVAL_MS = Number(process.env.REVENUE_AUTOPILOT_TICK_MS) || 60000;
const ERROR_BACKOFF_MS = Number(process.env.REVENUE_AUTOPILOT_BACKOFF_MS) || 120000;
const ENABLED = process.env.REVENUE_AUTOPILOT_TICK_ENABLED !== 'false';

let shuttingDown = false;

function log(msg: string) {
  console.log(`[revenue-autopilot-tick] ${new Date().toISOString()} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastStage: string | null = null;

/**
 * One tick: sync human actions (verify + resume satisfied goals), then
 * advance the mission. Exported for unit testing with injected deps.
 */
export async function runOnce(deps: { goals?: any; service?: any; realization?: any } = {}): Promise<{ stage: string | null }> {
  const goals = deps.goals || getGoalSystem();
  const service =
    deps.service ||
    new HumanActionService({ verifierDeps: { jobManager: new JobManager() } });

  await syncHumanActions(service, goals);

  // Payment signals: re-check open claims against internal records — a
  // webhook that landed since the last tick may now attribute them.
  // Terminal attributions resolve; the linked Human Action verifies on
  // the next syncHumanActions pass.
  try {
    const signalBridge = require('../lib/revenue/payment-signal-bridge.js');
    const sweep = await signalBridge.reconcileOpenSignals();
    if (sweep.resolved > 0) log(`payment-signals: ${sweep.resolved}/${sweep.checked} resolved`);
  } catch (err) {
    log(`payment-signal sweep error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const report = await advance({ goals, actor: 'revenue-autopilot-tick' });

  // Paid jobs parked in 'awaiting_review' — including jobs that did not
  // come through this mission — get one pass through the independent QA
  // gate each tick. Eligible jobs deliver; failing paid jobs escalate
  // once as interventions. Idempotent: eligibility re-checks are free.
  try {
    const { sweepAwaitingReview } = await import('../lib/revenue/JobExecutor');
    const sweep = await sweepAwaitingReview();
    if (sweep.delivered > 0 || sweep.escalated > 0) {
      log(`awaiting_review sweep: ${sweep.delivered} delivered, ${sweep.escalated} escalated`);
    }
  } catch (err) {
    log(`awaiting_review sweep error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Managed realization missions use the same boundary/resume machinery —
  // sweep each open appRealization goal through one idempotent pass so a
  // satisfied boundary (offer materialized, engine repaired, deploy
  // registered) resumes without waiting for a chat or API call.
  const realization = deps.realization || appRealization;
  const all = typeof goals.listGoals === 'function'
    ? await goals.listGoals({ limit: 300 }).catch(() => [])
    : [];
  const openApps = (all || []).filter(
    (g: any) => g.context?.appRealization?.appId && !['completed', 'cancelled'].includes(g.status),
  );
  for (const g of openApps) {
    try {
      const r = await realization.advance({ goals, appId: g.context.appRealization.appId, actor: 'revenue-autopilot-tick' });
      if (r?.stage === 'APP_REALIZED') log(`app-realization ${g.context.appRealization.appId} -> APP_REALIZED`);
    } catch (err) {
      log(`app-realization ${g.context.appRealization.appId} error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const stage = report && report.stage ? report.stage : null;
  if (stage !== lastStage) {
    log(`stage -> ${stage}${report && report.outcome ? ` (outcome: ${report.outcome})` : ''}`);
    lastStage = stage;
  }
  return { stage };
}

export interface TickLoopOptions {
  shouldStop?: () => boolean;
  sleepFn?: (ms: number) => Promise<void>;
  tickIntervalMs?: number;
  errorBackoffMs?: number;
  goals?: any;
  service?: any;
}

export async function mainLoop(options: TickLoopOptions = {}) {
  const shouldStop = options.shouldStop || (() => shuttingDown);
  const sleepFn = options.sleepFn || sleep;
  const tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
  const errorBackoffMs = options.errorBackoffMs ?? ERROR_BACKOFF_MS;

  log(`starting: revenue autopilot tick every ${tickIntervalMs}ms`);
  while (!shouldStop()) {
    try {
      await runOnce({ goals: options.goals, service: options.service });
    } catch (err) {
      log(`tick error (backing off ${errorBackoffMs}ms): ${err instanceof Error ? err.message : String(err)}`);
      await sleepFn(errorBackoffMs);
      continue;
    }
    await sleepFn(tickIntervalMs);
  }
  log('stopped');
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('revenue-autopilot-tick.ts');
if (isDirectRun && ENABLED) {
  process.on('SIGTERM', () => { shuttingDown = true; });
  process.on('SIGINT', () => { shuttingDown = true; });
  mainLoop().catch((err) => {
    log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
