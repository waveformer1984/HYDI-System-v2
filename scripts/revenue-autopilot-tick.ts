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
export async function runOnce(deps: { goals?: any; service?: any } = {}): Promise<{ stage: string | null }> {
  const goals = deps.goals || getGoalSystem();
  const service =
    deps.service ||
    new HumanActionService({ verifierDeps: { jobManager: new JobManager() } });

  await syncHumanActions(service, goals);
  const report = await advance({ goals, actor: 'revenue-autopilot-tick' });

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
