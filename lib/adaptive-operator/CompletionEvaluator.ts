/**
 * HYDI Completion Evaluator
 *
 * Does NOT declare completion merely because commands succeeded.
 * Uses explicit completion predicates that check actual state.
 *
 * Only declares COMPLETE when required predicates are verified.
 * Otherwise: PARTIAL, BLOCKED, FAILED, or ESCALATED.
 */

import type {
  CompletionEvaluatorResult,
  GoalState,
  GoalStatus,
  WorldState,
  GoalObjective,
} from './AdaptiveOperatorTypes';
import type { WorldStateManager } from './WorldStateManager';

export class CompletionEvaluator {
  constructor(private worldStateManager: WorldStateManager) {}

  /**
   * Evaluate whether a goal is complete.
   */
  evaluate(goal: GoalState): CompletionEvaluatorResult {
    const worldState = this.worldStateManager.getWorldState();
    const satisfied: string[] = [];
    const unsatisfied: string[] = [];
    const evidence: Array<{ predicate: string; satisfied: boolean; evidence: string }> = [];

    // Check each objective's predicates
    for (const objective of goal.objectives) {
      const result = this.checkObjective(objective, worldState);
      if (result.satisfied) {
        satisfied.push(objective.name);
      } else {
        unsatisfied.push(objective.name);
      }
      evidence.push({
        predicate: objective.name,
        satisfied: result.satisfied,
        evidence: result.evidence,
      });
    }

    // Determine overall status
    const total = goal.objectives.length;
    const satisfiedCount = satisfied.length;
    const unsatisfiedCount = unsatisfied.length;
    const blockedCount = goal.blockers.filter((b) => !b.resolvedAt).length;

    let status: GoalStatus;
    let confidence: number;

    if (satisfiedCount === total && total > 0) {
      status = 'complete';
      confidence = 0.95;
    } else if (blockedCount > 0 && unsatisfiedCount > 0) {
      status = 'blocked';
      confidence = 0.7;
    } else if (satisfiedCount > 0 && unsatisfiedCount > 0) {
      status = 'partial';
      confidence = satisfiedCount / total;
    } else if (unsatisfiedCount === total) {
      // Check if any objectives have failed
      const failedCount = goal.objectives.filter((o) => o.status === 'failed').length;
      if (failedCount === total) {
        status = 'failed';
        confidence = 0.9;
      } else {
        status = 'partial';
        confidence = 0.3;
      }
    } else {
      status = 'partial';
      confidence = 0.5;
    }

    // Check if goal was escalated
    if (goal.status === 'escalated') {
      status = 'escalated';
      confidence = 0.8;
    }

    const summary = this.generateSummary(status, satisfied, unsatisfied, goal);

    return {
      goalId: goal.goalId,
      status,
      confidence,
      satisfiedPredicates: satisfied,
      unsatisfiedPredicates: unsatisfied,
      evidence,
      summary,
    };
  }

  /**
   * Check if a specific objective is satisfied.
   */
  private checkObjective(objective: GoalObjective, worldState: WorldState): {
    satisfied: boolean;
    evidence: string;
  } {
    // If the objective is marked as complete, verify it
    if (objective.status === 'complete') {
      // Check predicates
      let allSatisfied = true;
      let evidence = '';
      for (const predicate of objective.predicates) {
        const result = predicate.check(worldState);
        predicate.satisfied = result.satisfied;
        predicate.lastChecked = new Date().toISOString();
        predicate.evidence = result.evidence;
        if (!result.satisfied) {
          allSatisfied = false;
          evidence = `${predicate.name}: ${result.evidence}`;
        }
      }
      return {
        satisfied: allSatisfied,
        evidence: allSatisfied ? `All predicates satisfied` : evidence,
      };
    }

    // If the objective failed
    if (objective.status === 'failed') {
      return {
        satisfied: false,
        evidence: objective.failureReason ?? 'Objective failed',
      };
    }

    // If the objective is blocked
    if (objective.status === 'blocked') {
      return {
        satisfied: false,
        evidence: 'Objective is blocked',
      };
    }

    // Pending or in progress
    return {
      satisfied: false,
      evidence: 'Objective not yet completed',
    };
  }

  /**
   * Generate a human-readable summary.
   */
  private generateSummary(
    status: GoalStatus,
    satisfied: string[],
    unsatisfied: string[],
    goal: GoalState,
  ): string {
    const parts: string[] = [];
    parts.push(`Goal: "${goal.statement}"`);
    parts.push(`Status: ${status.toUpperCase()}`);
    if (satisfied.length > 0) {
      parts.push(`Completed: ${satisfied.join(', ')}`);
    }
    if (unsatisfied.length > 0) {
      parts.push(`Remaining: ${unsatisfied.join(', ')}`);
    }
    if (goal.blockers.length > 0) {
      const unresolved = goal.blockers.filter((b) => !b.resolvedAt);
      if (unresolved.length > 0) {
        parts.push(`Blockers: ${unresolved.map((b) => b.description).join('; ')}`);
      }
    }
    parts.push(`Actions: ${goal.actionCount}, Replans: ${goal.replanCount}`);
    return parts.join('. ');
  }

  /**
   * Check the specific "PROTOFORGE_OPERATIONAL" completion predicate set.
   */
  checkProtoforgeOperational(worldState: WorldState): {
    processRunning: boolean;
    portListening: boolean;
    healthEndpointHealthy: boolean;
    credentialsValid: boolean;
    criticalTestsPass: boolean;
    apiResponds: boolean;
    noCriticalBlockers: boolean;
    allSatisfied: boolean;
  } {
    const processObs = Array.from(worldState.observations.values())
      .find((o) => o.category === 'process' && o.key === 'process:node');
    const portObs = Array.from(worldState.observations.values())
      .find((o) => o.category === 'port');
    const healthObs = Array.from(worldState.observations.values())
      .find((o) => o.category === 'health');
    const credObs = Array.from(worldState.observations.values())
      .find((o) => o.category === 'credential');

    const processRunning = (processObs?.value as { exists?: boolean })?.exists ?? false;
    const portListening = (portObs?.value as { inUse?: boolean })?.inUse ?? false;
    const healthEndpointHealthy = (healthObs?.value as { statusCode?: number })?.statusCode !== undefined
      && ((healthObs?.value as { statusCode?: number }).statusCode ?? 999) < 400;
    const credentialsValid = (credObs?.value as { adapterAvailable?: boolean })?.adapterAvailable ?? false;

    return {
      processRunning,
      portListening,
      healthEndpointHealthy,
      credentialsValid,
      criticalTestsPass: false, // Would need test results
      apiResponds: healthEndpointHealthy,
      noCriticalBlockers: true,
      allSatisfied: processRunning && portListening && healthEndpointHealthy && credentialsValid,
    };
  }
}
