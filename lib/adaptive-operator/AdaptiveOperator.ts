/**
 * HYDI Adaptive Operator
 *
 * The main orchestrator that sits ABOVE the existing HumanActionEngine.
 *
 * Control loop:
 *   GOAL → OBSERVE → DECOMPOSE → PLAN → AUTHORIZE → EXECUTE →
 *   OBSERVE RESULT → VERIFY → UPDATE WORLD MODEL → REPLAN →
 *   CONTINUE → COMPLETE / ESCALATE
 *
 * The critical capability is ADAPTIVE REPLANNING.
 * This is NOT a fixed sequence of predefined actions.
 *
 * Safety:
 *   - The operator does NOT directly execute shell/browser/API operations
 *   - It produces governed HumanAction intents
 *   - Those intents go through the existing POLICY → AUTHORIZATION → EXECUTION → VERIFICATION pipeline
 *   - Bounded autonomy prevents infinite loops
 *   - The planner obeys authorization denials — no bypass through replanning
 */

import { randomUUID } from 'crypto';
import type {
  AdaptiveOperatorOptions,
  AdaptivePlan,
  ActionBudget,
  AutonomyBounds,
  DeviationAnalysis,
  FailureRecord,
  GoalExecutionResult,
  GoalObjective,
  GoalState,
  GoalStatus,
  HumanInterventionRequest,
  Observation,
  PlanObjective,
  TaskMemoryEntry,
} from './AdaptiveOperatorTypes';
import { DEFAULT_AUTONOMY_BOUNDS } from './AdaptiveOperatorTypes';
import type { HumanActionEngine } from '../human-action/HumanActionEngine';
import type { HumanActionResult, HumanActionIntent } from '../human-action/HumanActionTypes';
import type { ActionCapabilityRegistry } from '../human-action/ActionCapabilityRegistry';
import { WorldStateManager } from './WorldStateManager';
import { ObservationEngine } from './ObservationEngine';
import { DynamicPlanner } from './DynamicPlanner';
import { ReplanningEngine } from './ReplanningEngine';
import { CompletionEvaluator } from './CompletionEvaluator';
import { TaskMemoryStore } from './TaskMemoryStore';
import { FailureClassifier, ActionBudgetTracker } from './FailureClassifier';

export class AdaptiveOperator {
  private engine: HumanActionEngine;
  private registry: ActionCapabilityRegistry;
  private worldStateManager: WorldStateManager;
  private observationEngine: ObservationEngine;
  private planner: DynamicPlanner;
  private replanningEngine: ReplanningEngine;
  private completionEvaluator: CompletionEvaluator;
  private taskMemory: TaskMemoryStore;
  private failureClassifier: FailureClassifier;
  private budgetTracker: ActionBudgetTracker;
  private bounds: AutonomyBounds;
  private authorityId: string | null;
  private rootDir: string;
  private onHumanIntervention?: (request: HumanInterventionRequest) => void;
  private onGoalComplete?: (goalId: string, status: GoalStatus, summary: string) => void;
  private onReplan?: (goalId: string, reason: string, newPlan: AdaptivePlan) => void;
  private onObservation?: (observation: Observation) => void;
  private goals: Map<string, GoalState> = new Map();
  private plans: Map<string, AdaptivePlan> = new Map();
  private failures: Map<string, FailureRecord[]> = new Map();
  private interventions: Map<string, HumanInterventionRequest[]> = new Map();

  constructor(engine: HumanActionEngine, registry: ActionCapabilityRegistry, options: AdaptiveOperatorOptions) {
    this.engine = engine;
    this.registry = registry;
    this.rootDir = options.rootDir;
    this.bounds = options.bounds ?? DEFAULT_AUTONOMY_BOUNDS;
    this.authorityId = options.authorityId ?? null;
    this.onHumanIntervention = options.onHumanIntervention;
    this.onGoalComplete = options.onGoalComplete;
    this.onReplan = options.onReplan;
    this.onObservation = options.onObservation;

    this.worldStateManager = new WorldStateManager();
    this.taskMemory = new TaskMemoryStore(this.rootDir);
    this.observationEngine = new ObservationEngine(this.worldStateManager, registry, this.rootDir);
    this.planner = new DynamicPlanner(this.worldStateManager, registry, this.rootDir, this.taskMemory);
    this.failureClassifier = new FailureClassifier();
    this.budgetTracker = new ActionBudgetTracker();
    this.replanningEngine = new ReplanningEngine(
      this.worldStateManager, this.observationEngine, this.taskMemory, this.failureClassifier,
    );
    this.completionEvaluator = new CompletionEvaluator(this.worldStateManager);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Execute a natural-language goal.
   * This is the main entry point.
   */
  async executeGoal(statement: string, statedBy: string, context?: string): Promise<GoalExecutionResult> {
    const goalId = randomUUID();
    const startTime = Date.now();

    // Create goal state
    const goal: GoalState = {
      goalId,
      statement,
      statedBy,
      context,
      constraints: [],
      objectives: [],
      status: 'observing',
      completionConfidence: 0,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      replanCount: 0,
      actionCount: 0,
      blockers: [],
      authorizationState: {
        authorityId: this.authorityId,
        pendingRequests: [],
        deniedActions: [],
        approvedActions: [],
      },
      verificationState: {
        verifiedObjectives: [],
        failedObjectives: [],
        pendingVerifications: [],
      },
    };
    this.goals.set(goalId, goal);
    this.failures.set(goalId, []);
    this.interventions.set(goalId, []);
    this.budgetTracker.init(goalId, this.bounds);

    // Phase 1: OBSERVE current state
    await this.observeEnvironment(goalId);

    // Phase 2: PLAN
    goal.status = 'planning';
    let plan = this.planner.plan(goal);
    this.plans.set(goalId, plan);

    // Convert plan objectives to goal objectives
    goal.objectives = this.planObjectivesToGoalObjectives(plan);

    // Phase 3: EXECUTE → OBSERVE → VERIFY → REPLAN loop
    goal.status = 'executing';

    let continueExecution = true;
    let loopIterations = 0;
    const maxLoopIterations = this.bounds.maxActionsPerPlan + this.bounds.maxReplans + 10;
    while (continueExecution) {
      loopIterations++;
      if (loopIterations > maxLoopIterations) {
        goal.status = 'escalated';
        goal.summary = `Max loop iterations reached (${maxLoopIterations})`;
        break;
      }

      // Check budget
      const budgetCheck = this.budgetTracker.isExhausted(goalId);
      if (budgetCheck.exhausted) {
        goal.status = 'escalated';
        goal.summary = `Budget exhausted: ${budgetCheck.reason}`;
        break;
      }

      // Execute the next pending objective
      const nextObjective = this.getNextPendingObjective(plan);
      if (!nextObjective) {
        // All objectives processed — evaluate completion
        break;
      }

      // If the objective has no intents, check if it's already satisfied or skip it
      if (nextObjective.intents.length === 0) {
        // No actions needed — mark as complete (the planner determined no action is needed)
        nextObjective.status = 'complete';
        nextObjective.completedAt = new Date().toISOString();
        continue;
      }

      // Execute the objective's intents
      for (const intent of nextObjective.intents) {
        const result = await this.engine.executeAction(intent, this.authorityId ?? undefined);
        this.budgetTracker.recordAction(goalId, result);
        goal.actionCount++;

        // Feed the action result back into the world state as an
        // observation. This is critical for revenue-engine goals: the
        // HTTP response body from a revenue/payout/connect-account query
        // needs to become a structured observation that the objective's
        // check() can verify against.
        this.recordActionResultAsObservation(intent, result, goalId);

        // Record in task memory
        this.taskMemory.record(goalId, 'action', {
          actionId: result.actionId,
          capability: intent.capability,
          target: intent.target,
          outcome: result.outcome,
          verified: result.verified,
          timestamp: new Date().toISOString(),
        }, result.actionId);

        // Handle interventions
        if (result.outcome === 'pending_human') {
          const intervention = (result.result as { intervention?: HumanInterventionRequest }).intervention;
          if (intervention) {
            this.interventions.get(goalId)?.push(intervention);
            goal.authorizationState.pendingRequests.push(intervention);
            if (this.onHumanIntervention) this.onHumanIntervention(intervention);
          }
          nextObjective.status = 'blocked';
          goal.status = 'pending_human';
          continueExecution = false;
          break;
        }

        // Handle denials — the planner OBEYS denials, no bypass
        if (result.outcome === 'denied') {
          goal.authorizationState.deniedActions.push(intent.capability);
          nextObjective.status = 'failed';
          nextObjective.failureReason = `Authorization denied: ${result.error}`;
          this.recordFailure(goalId, nextObjective.objectiveId, result);
          continue;
        }

        // Handle blocks
        if (result.outcome === 'blocked') {
          nextObjective.status = 'blocked';
          nextObjective.failureReason = result.error ?? 'Blocked';
          this.recordFailure(goalId, nextObjective.objectiveId, result);
          continue;
        }

        // Phase 4: ANALYZE DEVIATION
        const deviation = await this.replanningEngine.analyzeDeviation(nextObjective, result, goalId);

        if (deviation.classification === 'EXPECTED') {
          // Post-action verification: confirm the objective's check()
          // is actually satisfied against the updated world state, not
          // just that the action returned successfully. This prevents
          // false completion when an action succeeds but the result
          // doesn't satisfy the objective's verification condition
          // (e.g., HTTP 200 with unmatched payouts).
          const verification = this.planner.verifyObjective(nextObjective.name);
          if (verification && !verification.satisfied) {
            // Action succeeded but objective is NOT verified — this is
            // a deviation, not a completion. The action's result was
            // recorded as an observation, but the objective's check()
            // says the condition isn't met.
            nextObjective.retryCount++;
            this.budgetTracker.recordRetry(goalId);
            if (nextObjective.retryCount < nextObjective.maxRetries) {
              // Replan — the action succeeded but didn't achieve the goal
              goal.status = 'replanning';
              goal.replanCount++;
              this.budgetTracker.recordReplan(goalId);
              if (this.onReplan) {
                this.onReplan(goalId, `Expected: ${nextObjective.expectedOutcome}. Actual: ${verification.evidence}. Deviation is recoverable.`, plan);
              }
              plan = this.planner.replan(goal, plan, `Objective ${nextObjective.name} not verified: ${verification.evidence}`);
              break;
            }
            nextObjective.status = 'failed';
            nextObjective.failureReason = `Verification failed: ${verification.evidence}`;
            this.recordFailure(goalId, nextObjective.objectiveId, result);
            continue;
          }
          nextObjective.status = 'complete';
          nextObjective.completedAt = new Date().toISOString();
          nextObjective.results = [...(nextObjective.results ?? []), result];
          goal.verificationState.verifiedObjectives.push(nextObjective.name);
        } else if (deviation.classification === 'RECOVERABLE_DEVIATION' ||
                   deviation.classification === 'NEW_INFORMATION' ||
                   deviation.classification === 'BLOCKER') {
          // Phase 5: REPLAN
          nextObjective.retryCount++;
          this.budgetTracker.recordRetry(goalId);

          if (deviation.recommendedAction === 'RETRY' && nextObjective.retryCount < nextObjective.maxRetries) {
            // Retry the same intent — decrement the loop index so it repeats
            const intentIndex = nextObjective.intents.indexOf(intent);
            if (intentIndex >= 0 && intentIndex > 0) {
              // Re-execute this intent by adjusting the loop
              // We can't easily retry within a for..of, so record the retry and continue
              // The intent will be re-executed in the next loop iteration
              this.taskMemory.record(goalId, 'decision', {
                decision: 'retry',
                intent: intent.capability,
                retryCount: nextObjective.retryCount,
                timestamp: new Date().toISOString(),
              });
            }
            continue;
          }

          if (deviation.recommendedAction === 'REPLAN' || nextObjective.retryCount >= nextObjective.maxRetries) {
            // Investigate first
            await this.replanningEngine.investigate(nextObjective, result, goalId);

            // Replan
            goal.status = 'replanning';
            goal.replanCount++;
            this.budgetTracker.recordReplan(goalId);
            plan = this.planner.replan(goal, plan, deviation.reason);
            this.plans.set(goalId, plan);
            goal.objectives = this.planObjectivesToGoalObjectives(plan);
            goal.status = 'executing';
            goal.lastReplanAt = new Date().toISOString();

            if (this.onReplan) this.onReplan(goalId, deviation.reason, plan);

            // Record replan in task memory
            this.taskMemory.record(goalId, 'replan', {
              reason: deviation.reason,
              classification: deviation.classification,
              previousObjective: nextObjective.name,
              newPlanVersion: plan.version,
            });

            // Break out of the intent loop — the new plan will be executed in the next iteration
            break;
          }

          if (deviation.recommendedAction === 'INVESTIGATE') {
            await this.replanningEngine.investigate(nextObjective, result, goalId);
            // Replan after investigation
            goal.status = 'replanning';
            goal.replanCount++;
            this.budgetTracker.recordReplan(goalId);
            plan = this.planner.replan(goal, plan, `Investigation triggered replan: ${deviation.reason}`);
            this.plans.set(goalId, plan);
            goal.objectives = this.planObjectivesToGoalObjectives(plan);
            goal.status = 'executing';
            if (this.onReplan) this.onReplan(goalId, deviation.reason, plan);
            break;
          }
        } else if (deviation.classification === 'AUTHORIZATION_REQUIRED') {
          nextObjective.status = 'blocked';
          goal.status = 'pending_human';
          continueExecution = false;
          break;
        } else if (deviation.classification === 'UNSUPPORTED') {
          nextObjective.status = 'failed';
          nextObjective.failureReason = `Unsupported: ${result.error}`;
          this.recordFailure(goalId, nextObjective.objectiveId, result);
          // Try to work around
          goal.status = 'replanning';
          goal.replanCount++;
          this.budgetTracker.recordReplan(goalId);
          plan = this.planner.replan(goal, plan, `Unsupported operation: ${result.error}`);
          this.plans.set(goalId, plan);
          goal.objectives = this.planObjectivesToGoalObjectives(plan);
          goal.status = 'executing';
          if (this.onReplan) this.onReplan(goalId, `Unsupported: ${result.error}`, plan);
          break;
        } else if (deviation.classification === 'FAILURE') {
          nextObjective.status = 'failed';
          nextObjective.failureReason = result.error ?? 'Action failed';
          this.recordFailure(goalId, nextObjective.objectiveId, result);
          goal.verificationState.failedObjectives.push(nextObjective.name);
        } else if (deviation.classification === 'UNKNOWN') {
          // Investigate unknown outcomes
          await this.replanningEngine.investigate(nextObjective, result, goalId);
          nextObjective.status = 'blocked';
          this.recordFailure(goalId, nextObjective.objectiveId, result);
        }
      }

      // After processing all intents, if the objective is still pending, check if
      // all intents were verified. Only mark as complete if all intents succeeded.
      if (nextObjective.status === 'pending') {
        const allResults = nextObjective.results ?? [];
        const allVerified = allResults.length > 0 && allResults.every((r) => r.verified);
        if (allVerified) {
          nextObjective.status = 'complete';
          nextObjective.completedAt = new Date().toISOString();
        } else if (allResults.length === 0) {
          // No intents were executed (empty intents) — mark as complete
          nextObjective.status = 'complete';
          nextObjective.completedAt = new Date().toISOString();
        } else {
          // Some intents failed — mark as failed
          nextObjective.status = 'failed';
          nextObjective.failureReason = 'Not all intents were verified';
          goal.verificationState.failedObjectives.push(nextObjective.name);
        }
      }

      // Re-observe after each objective
      if (continueExecution && goal.status === 'executing') {
        await this.observeEnvironment(goalId);
      }
    }

    // Phase 6: SYNC goal objectives with plan objectives
    this.syncGoalObjectivesFromPlan(goal, plan);

    // Phase 7: EVALUATE COMPLETION
    const completionResult = this.completionEvaluator.evaluate(goal);
    goal.status = completionResult.status;
    goal.completionConfidence = completionResult.confidence;
    goal.summary = completionResult.summary;
    goal.completedAt = new Date().toISOString();

    // Persist task memory
    await this.taskMemory.persist(goalId);

    // Notify completion
    if (this.onGoalComplete) {
      this.onGoalComplete(goalId, goal.status, goal.summary ?? '');
    }

    const budget = this.budgetTracker.get(goalId);
    const durationMs = Date.now() - startTime;

    return {
      goalId,
      status: goal.status,
      summary: goal.summary ?? '',
      objectivesCompleted: completionResult.satisfiedPredicates.length,
      objectivesFailed: completionResult.unsatisfiedPredicates.length,
      objectivesBlocked: goal.blockers.filter((b) => !b.resolvedAt).length,
      actionsExecuted: goal.actionCount,
      replans: goal.replanCount,
      durationMs,
      budget: budget!,
      worldState: this.worldStateManager.getWorldState(),
      plan: this.plans.get(goalId)!,
      failures: this.failures.get(goalId) ?? [],
      interventions: this.interventions.get(goalId) ?? [],
      completionConfidence: goal.completionConfidence,
    };
  }

  /**
   * Get the world state.
   */
  getWorldState() {
    return this.worldStateManager.getWorldState();
  }

  /**
   * Get task memory for a goal.
   */
  getTaskMemory(goalId: string): TaskMemoryEntry[] {
    return this.taskMemory.getAll(goalId);
  }

  /**
   * Get the current plan for a goal.
   */
  getPlan(goalId: string): AdaptivePlan | null {
    return this.plans.get(goalId) ?? null;
  }

  /**
   * Get the goal state.
   */
  getGoal(goalId: string): GoalState | null {
    return this.goals.get(goalId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  /**
   * Observe the current environment and update world state.
   */
  private async observeEnvironment(goalId: string): Promise<void> {
    const observations = await this.observationEngine.scanEnvironment(goalId);
    for (const obs of observations) {
      if (this.onObservation) this.onObservation(obs);
      this.taskMemory.record(goalId, 'observation', {
        key: obs.key,
        summary: obs.summary,
        confidence: obs.confidence,
        timestamp: obs.timestamp,
      });
    }
  }

  /**
   * Feed an action result back into the world state as a structured
   * observation. This is critical for revenue-engine goals: the HTTP
   * response body from a revenue/payout/connect-account query needs to
   * become a structured observation that the objective's check() can
   * verify against.
   *
   * Mapping rules:
   *   - network.http_request → parse JSON response body, map to
   *     revenue:* observation keys based on the response shape
   *   - infra.health_check → map to health:* observation key
   *   - Other capabilities → generic action:result observation
   */
  private recordActionResultAsObservation(
    intent: HumanActionIntent,
    result: HumanActionResult,
    goalId: string,
  ): void {
    if (result.outcome !== 'success') return;
    if (!result.result) return;

    let obsKey = '';
    let obsCategory: import('./AdaptiveOperatorTypes').ObservationCategory = 'action_result';
    let obsValue: Record<string, unknown> = {};
    let obsSummary = '';

    const rawResult = result.result as Record<string, unknown>;

    if (intent.capability === 'network.http_request') {
      // Try to parse the HTTP response body as JSON
      let body: unknown = rawResult.body ?? rawResult.data ?? rawResult;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* not JSON */ }
      }

      // Map response shape to observation key
      const obj = body as Record<string, unknown>;
      if (obj && typeof obj === 'object') {
        if ('entryCount' in obj || 'verifiedCount' in obj || 'unverifiedCount' in obj) {
          obsKey = 'revenue:ledger_summary';
          obsCategory = 'revenue';
          obsValue = obj;
          obsSummary = `Revenue ledger: ${obj.entryCount ?? 0} entries, ${(obj.unverifiedCount ?? 0)} unverified`;
        } else if ('matched' in obj || 'unmatched' in obj || 'pending' in obj) {
          obsKey = 'revenue:payout_reconciliation';
          obsCategory = 'revenue';
          obsValue = obj;
          obsSummary = `Payout reconciliation: matched=${obj.matched ?? 0}, unmatched=${obj.unmatched ?? 0}, pending=${obj.pending ?? 0}`;
        } else if ('chargesEnabled' in obj || 'payoutsEnabled' in obj || 'detailsSubmitted' in obj) {
          obsKey = 'revenue:connect_account';
          obsCategory = 'revenue';
          obsValue = obj;
          obsSummary = `Connect account: charges=${obj.chargesEnabled}, payouts=${obj.payoutsEnabled}, details=${obj.detailsSubmitted}`;
        } else if ('summary' in obj && typeof obj.summary === 'object') {
          // Wrapped response — check the summary object
          const summary = obj.summary as Record<string, unknown>;
          if ('entryCount' in summary || 'verifiedCount' in summary) {
            obsKey = 'revenue:ledger_summary';
            obsCategory = 'revenue';
            obsValue = summary;
            obsSummary = `Revenue ledger: ${summary.entryCount ?? 0} entries, ${summary.unverifiedCount ?? 0} unverified`;
          }
        }
      }

      // Fallback: generic HTTP observation
      if (!obsKey) {
        obsKey = `http:${intent.target}`;
        obsCategory = 'api';
        obsValue = { statusCode: rawResult.statusCode ?? 200, body: body };
        obsSummary = `HTTP ${rawResult.statusCode ?? 200} from ${intent.target}`;
      }
    } else if (intent.capability === 'infra.health_check') {
      obsKey = `health:${intent.target}`;
      obsCategory = 'health';
      obsValue = rawResult;
      obsSummary = `Health check ${intent.target}: ${rawResult.healthy ? 'healthy' : 'unhealthy'}`;
    } else {
      // Generic action result observation
      obsKey = `action:${intent.capability}:${intent.target}`;
      obsCategory = 'action_result';
      obsValue = { outcome: result.outcome, result: rawResult };
      obsSummary = `${intent.capability} on ${intent.target}: ${result.outcome}`;
    }

    if (obsKey) {
      const obs = this.worldStateManager.observe({
        timestamp: new Date().toISOString(),
        source: 'action_result',
        confidence: result.verified ? 0.95 : 0.7,
        freshness: 'current' as const,
        correlationId: goalId,
        category: obsCategory,
        key: obsKey,
        value: obsValue,
        summary: obsSummary,
      });
      if (this.onObservation) this.onObservation(obs);
    }
  }

  /**
   * Get the next pending objective from the plan.
   */
  private getNextPendingObjective(plan: AdaptivePlan): PlanObjective | null {
    // Find the first objective in execution order that is pending or in_progress, and whose dependencies are met
    for (const objId of plan.executionOrder) {
      const obj = plan.objectives.find((o) => o.objectiveId === objId);
      if (!obj) continue;
      if (obj.status !== 'pending' && obj.status !== 'in_progress') continue;

      // Check dependencies
      const depsMet = obj.dependsOn.every((depName) => {
        const dep = plan.objectives.find((o) => o.name === depName);
        return dep?.status === 'complete';
      });

      if (depsMet) return obj;
    }
    return null;
  }

  /**
   * Convert plan objectives to goal objectives.
   */
  private planObjectivesToGoalObjectives(plan: AdaptivePlan): GoalObjective[] {
    return plan.objectives.map((po) => ({
      objectiveId: po.objectiveId,
      name: po.name,
      description: po.description,
      status: po.status as 'pending' | 'in_progress' | 'complete' | 'failed' | 'blocked' | 'skipped',
      predicates: [], // Predicates are checked via the completion evaluator
      discoveredAt: plan.createdAt,
      completedAt: po.completedAt,
      failureReason: po.failureReason,
    }));
  }

  /**
   * Sync goal objectives with the current plan objectives after execution.
   */
  private syncGoalObjectivesFromPlan(goal: GoalState, plan: AdaptivePlan): void {
    goal.objectives = plan.objectives.map((po) => ({
      objectiveId: po.objectiveId,
      name: po.name,
      description: po.description,
      status: po.status as 'pending' | 'in_progress' | 'complete' | 'failed' | 'blocked' | 'skipped',
      predicates: [],
      discoveredAt: plan.createdAt,
      completedAt: po.completedAt,
      failureReason: po.failureReason,
    }));
  }

  /**
   * Record a failure.
   */
  private recordFailure(goalId: string, objectiveId: string, result: HumanActionResult): void {
    const failure = this.failureClassifier.classify(result, goalId, objectiveId);
    this.failures.get(goalId)?.push(failure);
    this.taskMemory.record(goalId, 'outcome', {
      failure: failure.classification,
      description: failure.description,
      retryable: failure.retryable,
      timestamp: failure.timestamp,
    }, result.actionId);
  }
}
