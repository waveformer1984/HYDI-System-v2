/**
 * HYDI Replanning Engine
 *
 * The critical adaptive component. After every meaningful action:
 *   OBSERVE → COMPARE EXPECTED VS ACTUAL → CLASSIFY DEVIATION → DECIDE
 *
 * Possible results:
 *   EXPECTED, RECOVERABLE_DEVIATION, NEW_INFORMATION, BLOCKER,
 *   AUTHORIZATION_REQUIRED, UNSUPPORTED, FAILURE, UNKNOWN
 *
 * For recoverable deviations, generates a new plan.
 * Does NOT blindly retry the same action.
 */

import { randomUUID } from 'crypto';
import type {
  AdaptivePlan,
  DeviationAnalysis,
  DeviationClassification,
  HumanActionResult,
  Observation,
  PlanObjective,
  ReplanningAction,
  WorldState,
} from './AdaptiveOperatorTypes';
import type { WorldStateManager } from './WorldStateManager';
import type { ObservationEngine } from './ObservationEngine';
import type { TaskMemoryStore } from './TaskMemoryStore';
import type { FailureClassifier } from './FailureClassifier';

export class ReplanningEngine {
  constructor(
    private worldStateManager: WorldStateManager,
    private observationEngine: ObservationEngine,
    private taskMemory: TaskMemoryStore,
    private failureClassifier: FailureClassifier,
  ) {}

  /**
   * Analyze the result of an action and classify the deviation.
   */
  async analyzeDeviation(
    objective: PlanObjective,
    actionResult: HumanActionResult,
    goalId: string,
  ): Promise<DeviationAnalysis> {
    const expectedOutcome = objective.expectedOutcome;
    const actualOutcome = this.summarizeResult(actionResult);

    // Classify the deviation
    const classification = this.classifyDeviation(actionResult, objective);
    const confidence = this.assessConfidence(actionResult, classification);

    // Determine recommended action
    const recommendedAction = this.determineAction(classification, actionResult, objective);

    // Collect new observations
    const newObservations = this.collectNewObservations(actionResult, goalId);

    // Record in task memory
    if (classification !== 'EXPECTED') {
      this.taskMemory.record(goalId, 'failed_approach', {
        description: `${objective.intents[0]?.capability}:${objective.intents[0]?.target}`,
        objective: objective.name,
        classification,
        reason: actionResult.error ?? actualOutcome,
        timestamp: new Date().toISOString(),
      }, actionResult.actionId);
    } else {
      this.taskMemory.record(goalId, 'successful_approach', {
        description: `${objective.intents[0]?.capability}:${objective.intents[0]?.target}`,
        objective: objective.name,
        timestamp: new Date().toISOString(),
      }, actionResult.actionId);
    }

    return {
      analysisId: randomUUID(),
      actionResult,
      expectedOutcome,
      actualOutcome,
      classification,
      confidence,
      reason: this.explainDeviation(classification, expectedOutcome, actualOutcome, actionResult),
      recommendedAction,
      newObservations,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Classify the deviation from expected outcome.
   */
  private classifyDeviation(
    result: HumanActionResult,
    objective: PlanObjective,
  ): DeviationClassification {
    // If the action was verified successful
    if (result.verified && result.outcome === 'success') {
      return 'EXPECTED';
    }

    // If the action is pending human authorization
    if (result.outcome === 'pending_human') {
      return 'AUTHORIZATION_REQUIRED';
    }

    // If the action was denied
    if (result.outcome === 'denied') {
      // Check if it's a capability issue
      if (result.error?.includes('not registered') || result.error?.includes('not available')) {
        return 'UNSUPPORTED';
      }
      return 'AUTHORIZATION_REQUIRED';
    }

    // If the action was blocked
    if (result.outcome === 'blocked') {
      if (result.error?.includes('not installed') || result.error?.includes('UNSUPPORTED')) {
        return 'UNSUPPORTED';
      }
      return 'BLOCKER';
    }

    // If verification failed (check this BEFORE execution failure, since
    // verification failures have outcome 'failure' but state 'VERIFICATION_FAILED')
    if (result.state === 'VERIFICATION_FAILED' || result.state === 'ROLLBACK_FAILED') {
      return 'RECOVERABLE_DEVIATION';
    }

    // If the action failed
    if (result.outcome === 'failure' || result.state === 'EXECUTION_FAILED') {
      // Check if this is a recoverable deviation
      if (this.isRecoverable(result, objective)) {
        return 'RECOVERABLE_DEVIATION';
      }
      return 'FAILURE';
    }

    // If the action was rolled back
    if (result.outcome === 'rolled_back') {
      return 'RECOVERABLE_DEVIATION';
    }

    // Check if we learned something new
    if (result.executed && !result.verified) {
      return 'NEW_INFORMATION';
    }

    return 'UNKNOWN';
  }

  /**
   * Determine if a failure is recoverable.
   */
  private isRecoverable(result: HumanActionResult, objective: PlanObjective): boolean {
    // Check retry count
    if (objective.retryCount >= objective.maxRetries) {
      return false;
    }

    // Check if the error is transient
    const error = result.error ?? '';
    const transientPatterns = [
      'timeout', 'timed out', 'ECONNRESET', 'ECONNREFUSED',
      'temporary', 'busy', 'rate limit', 'throttled',
    ];
    const isTransient = transientPatterns.some((p) => error.toLowerCase().includes(p));
    if (isTransient) return true;

    // Check if the failure is due to environment state that can be changed
    const environmentPatterns = [
      'port', 'in use', 'already occupied', 'EADDRINUSE',
      'not found', 'does not exist', 'no such file',
      'permission denied', 'EACCES',
    ];
    const isEnvironment = environmentPatterns.some((p) => error.toLowerCase().includes(p));
    if (isEnvironment) return true;

    // Check task memory for previous failed approaches with the same capability
    const failedApproaches = this.taskMemory.getFailedApproaches(result.actionId);
    if (failedApproaches.length >= objective.maxRetries) {
      return false;
    }

    return false;
  }

  /**
   * Determine the recommended action based on deviation classification.
   */
  private determineAction(
    classification: DeviationClassification,
    result: HumanActionResult,
    objective: PlanObjective,
  ): ReplanningAction {
    switch (classification) {
      case 'EXPECTED':
        return 'CONTINUE';

      case 'RECOVERABLE_DEVIATION':
        // If we haven't exceeded retries, retry
        if (objective.retryCount < objective.maxRetries) {
          return 'RETRY';
        }
        // Otherwise, replan
        return 'REPLAN';

      case 'NEW_INFORMATION':
        // We learned something — replan with the new information
        return 'REPLAN';

      case 'BLOCKER':
        // Need to investigate the blocker
        return 'INVESTIGATE';

      case 'AUTHORIZATION_REQUIRED':
        return 'REQUEST_AUTHORIZATION';

      case 'UNSUPPORTED':
        // Try to find an alternative approach
        return 'WORK_AROUND';

      case 'FAILURE':
        // Check if we can repair
        return 'REPAIR';

      case 'UNKNOWN':
        // Don't know what happened — investigate
        return 'INVESTIGATE';

      default:
        return 'INVESTIGATE';
    }
  }

  /**
   * Assess confidence in the deviation classification.
   */
  private assessConfidence(result: HumanActionResult, classification: DeviationClassification): number {
    if (classification === 'EXPECTED') return 0.95;
    if (classification === 'AUTHORIZATION_REQUIRED') return 0.9;
    if (classification === 'UNSUPPORTED') return 0.85;
    if (classification === 'BLOCKER') return 0.8;
    if (classification === 'FAILURE') return 0.7;
    if (classification === 'RECOVERABLE_DEVIATION') return 0.65;
    if (classification === 'NEW_INFORMATION') return 0.6;
    return 0.4; // UNKNOWN
  }

  /**
   * Explain the deviation in human-readable terms.
   */
  private explainDeviation(
    classification: DeviationClassification,
    expected: string,
    actual: string,
    result: HumanActionResult,
  ): string {
    switch (classification) {
      case 'EXPECTED':
        return `Expected: ${expected}. Actual: ${actual}. Result matches expectation.`;
      case 'RECOVERABLE_DEVIATION':
        return `Expected: ${expected}. Actual: ${actual}. Deviation is recoverable. Error: ${result.error ?? 'none'}`;
      case 'NEW_INFORMATION':
        return `Expected: ${expected}. Actual: ${actual}. New information discovered that may change the plan.`;
      case 'BLOCKER':
        return `Expected: ${expected}. Actual: ${actual}. Blocked by: ${result.error ?? 'unknown blocker'}`;
      case 'AUTHORIZATION_REQUIRED':
        return `Expected: ${expected}. Actual: ${actual}. Human authorization required.`;
      case 'UNSUPPORTED':
        return `Expected: ${expected}. Actual: ${actual}. Capability is not available: ${result.error ?? 'unsupported'}`;
      case 'FAILURE':
        return `Expected: ${expected}. Actual: ${actual}. Action failed: ${result.error ?? 'unknown error'}`;
      case 'UNKNOWN':
        return `Expected: ${expected}. Actual: ${actual}. Unexpected outcome — needs investigation.`;
      default:
        return `Deviation: ${classification}`;
    }
  }

  /**
   * Summarize an action result for comparison.
   */
  private summarizeResult(result: HumanActionResult): string {
    if (result.verified) return `Verified success: ${result.state}`;
    if (result.outcome === 'denied') return `Denied: ${result.error ?? 'no reason'}`;
    if (result.outcome === 'blocked') return `Blocked: ${result.error ?? 'no reason'}`;
    if (result.outcome === 'pending_human') return `Pending human: ${result.state}`;
    if (result.state === 'EXECUTION_FAILED') return `Execution failed: ${result.error ?? 'unknown'}`;
    if (result.state === 'VERIFICATION_FAILED') return `Verification failed: ${result.error ?? 'unknown'}`;
    if (result.outcome === 'rolled_back') return `Rolled back: ${result.error ?? 'unknown'}`;
    return `State: ${result.state}, outcome: ${result.outcome}`;
  }

  /**
   * Collect new observations from an action result.
   */
  private collectNewObservations(result: HumanActionResult, goalId: string): Observation[] {
    // The evidence from the action result can be treated as observations
    const observations: Observation[] = [];
    for (const evidence of result.evidence) {
      observations.push({
        observationId: randomUUID(),
        timestamp: evidence.checkedAt ?? new Date().toISOString(),
        source: 'inference',
        confidence: 0.7,
        freshness: 'current',
        correlationId: result.actionId,
        category: 'action_result',
        key: `action_result:${result.actionId}:${evidence.check}`,
        value: {
          check: evidence.check,
          status: evidence.status,
          value: evidence.value,
          detail: evidence.detail,
        },
        summary: `${evidence.check}: ${evidence.status} — ${evidence.value}`,
      });
    }
    return observations;
  }

  /**
   * Investigate a blocker by observing the environment.
   */
  async investigate(
    objective: PlanObjective,
    result: HumanActionResult,
    goalId: string,
  ): Promise<Observation[]> {
    const observations: Observation[] = [];

    // Observe the target of the failed action
    if (objective.intents.length > 0) {
      const intent = objective.intents[0];
      const target = intent.target;

      // Determine what to observe based on the capability
      if (intent.capability.startsWith('filesystem')) {
        const obsResult = await this.observationEngine.observe({
          category: 'file',
          target,
          correlationId: goalId,
        });
        if (obsResult.success && obsResult.observation) observations.push(obsResult.observation);
      } else if (intent.capability.startsWith('process')) {
        const obsResult = await this.observationEngine.observe({
          category: 'process',
          target,
          correlationId: goalId,
        });
        if (obsResult.success && obsResult.observation) observations.push(obsResult.observation);
      } else if (intent.capability.startsWith('infra.health_check') || intent.target.startsWith('http')) {
        const obsResult = await this.observationEngine.observe({
          category: 'health',
          target,
          correlationId: goalId,
        });
        if (obsResult.success && obsResult.observation) observations.push(obsResult.observation);
      } else if (intent.capability.startsWith('dev.git')) {
        const obsResult = await this.observationEngine.observe({
          category: 'git_state',
          target,
          correlationId: goalId,
        });
        if (obsResult.success && obsResult.observation) observations.push(obsResult.observation);
      }
    }

    // Record investigation in task memory
    this.taskMemory.record(goalId, 'observation', {
      reason: `Investigating blocker for objective ${objective.name}`,
      observations: observations.map((o) => ({ key: o.key, summary: o.summary })),
      timestamp: new Date().toISOString(),
    });

    return observations;
  }

  /**
   * Generate a recovery plan for a specific deviation.
   */
  generateRecoveryPlan(
    objective: PlanObjective,
    deviation: DeviationAnalysis,
    goalId: string,
  ): PlanObjective[] {
    const recoveryObjectives: PlanObjective[] = [];

    switch (deviation.classification) {
      case 'RECOVERABLE_DEVIATION': {
        // Check what went wrong and generate investigation objectives
        if (deviation.actionResult.error?.includes('port') || deviation.actionResult.error?.includes('EADDRINUSE')) {
          // Port conflict — investigate what's using the port
          recoveryObjectives.push({
            objectiveId: randomUUID(),
            name: 'INVESTIGATE_PORT_CONFLICT',
            description: 'Investigate what process is using the conflicting port',
            status: 'pending',
            intents: [{
              intentId: randomUUID(), goalId, actor: 'heidi',
              category: 'SYSTEM' as const, capability: 'process.inspect',
              operation: 'inspect', target: 'node', parameters: {},
              reason: 'Investigate port conflict', expectedResult: 'Identify process using the port',
            }],
            dependsOn: [],
            expectedOutcome: 'Process identified',
            verificationStrategy: 'state_check',
            riskLevel: 'R0',
            retryCount: 0,
            maxRetries: 1,
          });
        }
        break;
      }

      case 'BLOCKER': {
        // Generate investigation objectives
        recoveryObjectives.push({
          objectiveId: randomUUID(),
          name: 'INVESTIGATE_BLOCKER',
          description: `Investigate blocker: ${deviation.actionResult.error ?? 'unknown'}`,
          status: 'pending',
          intents: [],
          dependsOn: [],
          expectedOutcome: 'Blocker understood',
          verificationStrategy: 'state_check',
          riskLevel: 'R0',
          retryCount: 0,
          maxRetries: 1,
        });
        break;
      }

      case 'UNSUPPORTED': {
        // Try to find an alternative approach
        recoveryObjectives.push({
          objectiveId: randomUUID(),
          name: 'FIND_ALTERNATIVE',
          description: `Find alternative approach for ${objective.name}`,
          status: 'pending',
          intents: [],
          dependsOn: [],
          expectedOutcome: 'Alternative approach found',
          verificationStrategy: 'state_check',
          riskLevel: 'R0',
          retryCount: 0,
          maxRetries: 1,
        });
        break;
      }
    }

    return recoveryObjectives;
  }
}
