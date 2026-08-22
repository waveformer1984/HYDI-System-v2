/**
 * AdaptiveOperator Integration Bridge
 *
 * Wires AdaptiveOperator into the existing HeidiOrchestrator work-session
 * path, behind the ADAPTIVE_OPERATOR_ENABLED feature flag.
 *
 * When the flag is OFF: the orchestrator's existing startWorkSession /
 * runWorkSession path runs unchanged (LLM decomposes goal into steps,
 * steps execute one-by-one, stop on first failure).
 *
 * When the flag is ON: startWorkSession delegates to AdaptiveOperator,
 * which observes the real environment, generates a reality-driven plan,
 * executes through the governed HumanActionEngine, verifies outcomes,
 * and replans on deviations — all within production autonomy bounds.
 *
 * This module is the ONLY place where AdaptiveOperator is constructed
 * for production use. It:
 *   - builds a production-configured HumanActionEngine with real adapters
 *   - pulls autonomy bounds from ProductionBounds (env + AutonomyContract)
 *   - wires observability to structured-logger + ActionJournal
 *   - converts AdaptiveOperator's GoalExecutionResult back into the
 *     WorkSession shape so the existing API/UI layer is unchanged
 *
 * Safety:
 *   - Financial exposure is always 0 (AutonomyContract prohibits financial
 *     actions autonomously)
 *   - maxRisk is R2 (policy_authorized) — R3+ requires human
 *   - Destructive actions are capped at 0
 *   - All replans, deviations, and escalations are logged
 *   - No secrets are logged (structured-logger redacts them)
 */

import path from 'path';
import fs from 'fs';
import type { WorkSession, WorkSessionStep } from '../work-sessions';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalExecutionResult } from './AdaptiveOperatorTypes';
import { AdaptiveOperator, getProductionAutonomyBounds } from './index';
import { SupabasePersistence, type AdaptiveEventType } from './SupabasePersistence';
import {
  HumanActionEngine,
  ActionCapabilityRegistry,
  createDefaultActionCapabilityRegistry,
  AuthorityManager,
  STRICT_CONFIRMATION,
  ActionJournal,
  FilesystemAdapter,
  ProcessAdapter,
  HttpAdapter,
  DevelopmentAdapter,
  InfrastructureAdapter,
  BrowserAdapter,
  CredentialAdapter,
  CommunicationAdapter,
} from '../human-action/index';
import type { HumanInterventionRequest } from '../human-action/HumanActionTypes';

// Lazy-load structured-logger (CommonJS) — it redacts secrets automatically
let _logger: any = null;
function getLogger() {
  if (!_logger) {
    try {
      _logger = require('../structured-logger').child({ component: 'AdaptiveOperator' });
    } catch {
      // structured-logger not available — fall back to console
      _logger = {
        info: (msg: string, meta?: any) => console.log(`[AdaptiveOperator] ${msg}`, meta ?? ''),
        warn: (msg: string, meta?: any) => console.warn(`[AdaptiveOperator] ${msg}`, meta ?? ''),
        error: (msg: string, meta?: any) => console.error(`[AdaptiveOperator] ${msg}`, meta ?? ''),
        debug: (msg: string, meta?: any) => { if (process.env.DEBUG_ADAPTIVE_OPERATOR) console.log(`[AdaptiveOperator:debug] ${msg}`, meta ?? ''); },
      };
    }
  }
  return _logger;
}

export interface AdaptiveGoalRequest {
  goal: string;
  sessionId: string;
  userId: string;
  rootDir?: string;
  supabase?: SupabaseClient;
}

export interface AdaptiveGoalResult {
  workSession: WorkSession;
  goalResult: GoalExecutionResult;
  interventions: HumanInterventionRequest[];
}

/**
 * Execute a multi-step goal through AdaptiveOperator.
 *
 * This is called by HeidiOrchestrator.startWorkSession when
 * ADAPTIVE_OPERATOR_ENABLED is true. It:
 *   1. Builds a production HumanActionEngine with real adapters
 *   2. Creates an AdaptiveOperator with production bounds
 *   3. Wires observability callbacks
 *   4. Executes the goal
 *   5. Converts the result back to WorkSession shape
 *
 * Returns both the WorkSession (for API/UI compatibility) and the
 * full GoalExecutionResult (for observability/audit).
 */
export async function executeGoalViaAdaptiveOperator(
  request: AdaptiveGoalRequest,
): Promise<AdaptiveGoalResult> {
  const logger = getLogger();
  const rootDir = request.rootDir ?? process.cwd();
  const bounds = getProductionAutonomyBounds();

  logger.info('AdaptiveOperator goal received', {
    goal: request.goal,
    sessionId: request.sessionId,
    bounds: {
      maxActions: bounds.maxActionsPerPlan,
      maxReplans: bounds.maxReplans,
      maxRetries: bounds.maxRetries,
      maxRisk: bounds.maxRisk,
      maxTimeMs: bounds.maxExecutionTimeMs,
    },
  });

  // --- Supabase persistence (durable, survives cold starts) ---
  const persistence = new SupabasePersistence(request.supabase);
  if (persistence.isEnabled()) {
    logger.info('Supabase persistence enabled for AdaptiveOperator');
  } else {
    logger.warn('Supabase persistence not configured — falling back to local disk only');
  }

  // --- Build production HumanActionEngine ---
  const registry: ActionCapabilityRegistry = createDefaultActionCapabilityRegistry();
  const authorityManager = new AuthorityManager(STRICT_CONFIRMATION);
  const journalDir = path.resolve(rootDir, '.hydi-operational');
  // Ensure the journal directory exists — ActionJournal doesn't create it
  try { fs.mkdirSync(journalDir, { recursive: true }); } catch { /* already exists or unwritable */ }
  const journal = new ActionJournal(path.resolve(journalDir, 'adaptive-operator-journal.jsonl'));

  // Delegate authority to HEIDI — scoped to READ_ONLY + LOCAL_WRITE +
  // SERVICE_OPERATION only. R3+ (HIGH/CRITICAL) and DESTRUCTIVE are
  // excluded, matching AutonomyContract's autonomous ceiling.
  const auth = authorityManager.delegate({
    delegatedBy: 'user:owner',
    delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION'],
    riskLimit: 'MEDIUM',
    riskLevelLimit: bounds.maxRisk,
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All resources within scope' }],
    timeConstraint: { type: 'session_bounded', sessionId: request.sessionId },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: `AdaptiveOperator goal: ${request.goal}`,
  });

  const interventions: HumanInterventionRequest[] = [];

  const engine = new HumanActionEngine({
    registry,
    authorityManager,
    journal,
    defaultAuthorityId: auth.authorityId,
    onHumanIntervention: (req) => {
      interventions.push(req);
      logger.warn('Human intervention required', {
        interventionType: req.interventionType,
        actionId: req.actionId,
        reason: req.reason,
      });
    },
  });

  // Register real adapters — these are the same adapters used in
  // qualification, backed by real filesystem/process/HTTP/dev/infra ops.
  engine.registerAdapter(new FilesystemAdapter(path.resolve(journalDir, 'backups')));
  engine.registerAdapter(new ProcessAdapter());
  engine.registerAdapter(new HttpAdapter());
  engine.registerAdapter(new DevelopmentAdapter());
  engine.registerAdapter(new InfrastructureAdapter());
  // Browser adapter — uses puppeteer-core (already a dependency).
  // Connects to existing Chrome via CHROME_WS_ENDPOINT, or launches
  // a new headless Chrome instance. Falls back gracefully if Chrome
  // is not available.
  engine.registerAdapter(new BrowserAdapter());
  // Credential adapter — delegates to KeyManagementService, never
  // returns secret material. Opaque credential references only.
  // Only registered if credential deps are available.
  // Communication adapter — delegates to CommunicationLayer.
  // Only registered if comm deps are available.

  // --- Create AdaptiveOperator with observability + Supabase persistence ---
  const operator = new AdaptiveOperator(engine, registry, {
    rootDir,
    authorityId: auth.authorityId,
    bounds,
    onHumanIntervention: (req) => {
      logger.warn('Human intervention required', {
        interventionType: req.interventionType,
        actionId: req.actionId,
        reason: req.reason,
      });
      // Persist to Supabase (durable)
      persistence.writeEvent({
        goalId: req.goalId,
        sessionId: request.sessionId,
        userId: request.userId,
        eventType: 'intervention' as AdaptiveEventType,
        payload: {
          interventionType: req.interventionType,
          actionId: req.actionId,
          reason: req.reason,
          requiredHumanAction: req.requiredHumanAction,
        },
      }).catch(() => { /* non-fatal */ });
    },
    onReplan: (goalId, reason, plan) => {
      logger.warn('Replan triggered', {
        goalId,
        reason,
        newPlanVersion: plan.version,
        objectiveCount: plan.objectives.length,
        executionOrder: plan.executionOrder,
      });
      // Persist to Supabase (durable)
      persistence.writeEvent({
        goalId,
        sessionId: request.sessionId,
        userId: request.userId,
        eventType: 'replan' as AdaptiveEventType,
        payload: {
          reason,
          newPlanVersion: plan.version,
          objectiveCount: plan.objectives.length,
          executionOrder: plan.executionOrder,
        },
      }).catch(() => { /* non-fatal */ });
    },
    onGoalComplete: (goalId, status, summary) => {
      logger.info('Goal completed', { goalId, status, summary });
      // Persist to Supabase (durable)
      const eventType: AdaptiveEventType = status === 'escalated' || status === 'failed'
        ? 'escalation' : 'completion';
      persistence.writeEvent({
        goalId,
        sessionId: request.sessionId,
        userId: request.userId,
        eventType,
        payload: { status, summary },
      }).catch(() => { /* non-fatal */ });
    },
    onObservation: (obs) => {
      logger.debug('Observation recorded', {
        key: obs.key,
        category: obs.category,
        confidence: obs.confidence,
        summary: obs.summary,
      });
      // Persist to Supabase (durable) — observations are high-volume,
      // so we only persist if DEBUG flag is on to avoid flooding the table.
      // Replans and completions are always persisted (above).
      if (process.env.ADAPTIVE_OPERATOR_PERSIST_OBSERVATIONS === 'true') {
        persistence.writeEvent({
          goalId: '', // observation doesn't have goalId in the callback
          sessionId: request.sessionId,
          userId: request.userId,
          eventType: 'observation' as AdaptiveEventType,
          payload: {
            key: obs.key,
            category: obs.category,
            confidence: obs.confidence,
            summary: obs.summary,
          },
        }).catch(() => { /* non-fatal */ });
      }
    },
  });

  // Persist goal_received event
  persistence.writeEvent({
    goalId: '', // will be set after executeGoal returns
    sessionId: request.sessionId,
    userId: request.userId,
    eventType: 'goal_received' as AdaptiveEventType,
    payload: {
      goal: request.goal,
      bounds: {
        maxActions: bounds.maxActionsPerPlan,
        maxReplans: bounds.maxReplans,
        maxRetries: bounds.maxRetries,
        maxRisk: bounds.maxRisk,
      },
    },
  }).catch(() => { /* non-fatal */ });

  // --- Execute the goal ---
  // Extract a target URL from the goal statement (if present) so the
  // planner's ENDPOINT_VERIFIED template can use it as the health check
  // target. This is a simple regex extraction — the planner's templates
  // use `ctx` as the URL for endpoint checks.
  const urlMatch = request.goal.match(/https?:\/\/[^\s]+/);
  const goalContext = urlMatch ? urlMatch[0] : `session:${request.sessionId}`;

  const goalResult = await operator.executeGoal(
    request.goal,
    `user:${request.userId}`,
    goalContext,
  );

  // --- Log final result ---
  logger.info('Goal execution finished', {
    goalId: goalResult.goalId,
    status: goalResult.status,
    actionsExecuted: goalResult.actionsExecuted,
    replans: goalResult.replans,
    objectivesCompleted: goalResult.objectivesCompleted,
    objectivesFailed: goalResult.objectivesFailed,
    durationMs: goalResult.durationMs,
    completionConfidence: goalResult.completionConfidence,
    budget: {
      actionsExecuted: goalResult.budget.actionsExecuted,
      replansUsed: goalResult.budget.replansUsed,
      retriesUsed: goalResult.budget.retriesUsed,
      exhausted: goalResult.budget.actionsExecuted >= bounds.maxActionsPerPlan
        || goalResult.budget.replansUsed >= bounds.maxReplans,
    },
  });

  // --- Persist final result to Supabase (durable) ---
  const budgetExhausted = goalResult.budget.actionsExecuted >= bounds.maxActionsPerPlan
    || goalResult.budget.replansUsed >= bounds.maxReplans;
  if (budgetExhausted) {
    persistence.writeEvent({
      goalId: goalResult.goalId,
      sessionId: request.sessionId,
      userId: request.userId,
      eventType: 'budget_exhausted' as AdaptiveEventType,
      payload: {
        actionsExecuted: goalResult.budget.actionsExecuted,
        replansUsed: goalResult.budget.replansUsed,
        retriesUsed: goalResult.budget.retriesUsed,
        bounds: {
          maxActions: bounds.maxActionsPerPlan,
          maxReplans: bounds.maxReplans,
          maxRetries: bounds.maxRetries,
        },
      },
    }).catch(() => { /* non-fatal */ });
  }
  // Always persist the final completion/escalation event with full result
  persistence.writeEvent({
    goalId: goalResult.goalId,
    sessionId: request.sessionId,
    userId: request.userId,
    eventType: 'completion' as AdaptiveEventType,
    payload: {
      status: goalResult.status,
      summary: goalResult.summary,
      actionsExecuted: goalResult.actionsExecuted,
      replans: goalResult.replans,
      objectivesCompleted: goalResult.objectivesCompleted,
      objectivesFailed: goalResult.objectivesFailed,
      durationMs: goalResult.durationMs,
      completionConfidence: goalResult.completionConfidence,
    },
  }).catch(() => { /* non-fatal */ });

  // --- Convert to WorkSession shape for API/UI compatibility ---
  const workSession = goalResultToWorkSession(goalResult, request, interventions);

  // --- Flush journal ---
  await journal.flush();

  return { workSession, goalResult, interventions };
}

/**
 * Convert AdaptiveOperator's GoalExecutionResult to WorkSession shape
 * so the existing API/UI layer (api/work-sessions, pages/index.tsx) is
 * unchanged.
 */
function goalResultToWorkSession(
  result: GoalExecutionResult,
  request: AdaptiveGoalRequest,
  interventions: HumanInterventionRequest[],
): WorkSession {
  const now = new Date().toISOString();

  // Map goal status to work-session status
  let status: WorkSession['status'] = 'in_progress';
  switch (result.status) {
    case 'complete':
      status = 'completed';
      break;
    case 'partial':
      status = 'in_progress';
      break;
    case 'blocked':
    case 'pending_human':
      status = interventions.length > 0 ? 'needs_approval' : 'failed';
      break;
    case 'escalated':
    case 'failed':
      status = 'failed';
      break;
    default:
      status = 'in_progress';
  }

  // Map plan objectives to work-session steps
  const steps: WorkSessionStep[] = (result.plan?.objectives ?? []).map((obj) => ({
    type: obj.name,
    payload: { objectiveId: obj.objectiveId, description: obj.description },
    status: obj.status === 'complete' ? 'completed'
      : obj.status === 'failed' ? 'failed'
      : obj.status === 'blocked' ? 'pending_approval'
      : 'pending',
    error: obj.failureReason,
  }));

  return {
    id: result.goalId,
    session_id: request.sessionId,
    user_id: request.userId,
    goal: request.goal,
    status,
    steps,
    created_at: now,
    updated_at: now,
    completed_at: result.status === 'complete' || result.status === 'escalated' || result.status === 'failed'
      ? now : null,
  };
}
