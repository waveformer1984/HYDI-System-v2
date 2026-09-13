/**
 * HYDI Action Selection — Deterministic Decision Layer
 *
 * Phase 4 — Takes observed state + dependency graph + policy + risk
 * and deterministically selects what action (if any) to take.
 *
 * Architecture:
 *   LLM → hypothesis → structured diagnosis → policy engine → action selector
 *        → capability authorizer → executor
 *
 * Never: LLM → shell command
 *
 * The LLM may propose a hypothesis. The deterministic action selector
 * decides what is actually eligible.
 *
 * Key principles:
 *   - The safest autonomous action is frequently doing nothing
 *   - Confidence ≠ authorization
 *   - Unknown capabilities are DENIED (no scope creep)
 */

import { randomUUID } from 'crypto';
import type {
  CandidateAction,
  ActionSelectionResult,
  ComponentHealth,
  DependencyGraph,
  Capability,
  CapabilityAuthorization,
  HealthEvidence,
  AutonomyPolicy,
} from './types';
import type { AutonomyPolicyModel } from './AutonomyPolicyModel';
import type { RiskClassifier } from './RiskClassifier';
import type { CapabilityAuthorizer } from './CapabilityAuthorizer';
import type { RecoveryBudgetManager } from './RecoveryBudget';
import type { SystemStateModel } from './SystemStateModel';

export class ActionSelector {
  private policyModel: AutonomyPolicyModel;
  private riskClassifier: RiskClassifier;
  private authorizer: CapabilityAuthorizer;
  private budgetManager: RecoveryBudgetManager;
  private stateModel: SystemStateModel;

  constructor(
    policyModel: AutonomyPolicyModel,
    riskClassifier: RiskClassifier,
    authorizer: CapabilityAuthorizer,
    budgetManager: RecoveryBudgetManager,
    stateModel: SystemStateModel,
  ) {
    this.policyModel = policyModel;
    this.riskClassifier = riskClassifier;
    this.authorizer = authorizer;
    this.budgetManager = budgetManager;
    this.stateModel = stateModel;
  }

  /**
   * Select an action for a component based on observed state.
   * This is the main entry point for governed autonomy.
   */
  selectAction(
    component: string,
    health: ComponentHealth,
    graph: DependencyGraph,
    incidentId: string,
    dryRun = false,
  ): ActionSelectionResult {
    // 1. If healthy, no action needed (idempotent policy)
    if (health.state === 'HEALTHY') {
      return this.createNoActionResult(component, 'component is HEALTHY — no action needed');
    }

    // 2. If BLOCKED, check if dependencies need recovery first
    if (health.state === 'BLOCKED') {
      const failedDeps = this.findFailedDependencies(health, graph);
      if (failedDeps.length > 0) {
        // The action is to recover the dependency, not this component
        return this.selectActionForDependency(failedDeps[0], graph, incidentId, dryRun);
      }
      return this.createNoActionResult(component, 'BLOCKED but no failed dependencies found — unclear state');
    }

    // 3. If ESCALATION_REQUIRED, no autonomous action — escalate
    if (health.state === 'ESCALATION_REQUIRED') {
      return this.createEscalationResult(component, 'component is in ESCALATION_REQUIRED state');
    }

    // 4. For UNAVAILABLE/FAILED — propose recovery
    if (health.state === 'UNAVAILABLE' || health.state === 'FAILED') {
      return this.selectRecoveryAction(component, health, graph, incidentId, dryRun);
    }

    // 5. For DEGRADED — may propose recovery if policy allows
    if (health.state === 'DEGRADED') {
      return this.selectRecoveryAction(component, health, graph, incidentId, dryRun);
    }

    // 6. For UNKNOWN/STARTING — no autonomous action
    return this.createNoActionResult(component, `state is ${health.state} — no autonomous action`);
  }

  /**
   * Select a recovery action for an unavailable/failed/degraded component.
   */
  private selectRecoveryAction(
    component: string,
    health: ComponentHealth,
    graph: DependencyGraph,
    incidentId: string,
    dryRun: boolean,
  ): ActionSelectionResult {
    // Check if there's a policy for this component
    const capability: Capability = 'health.recover';
    const policies = this.policyModel.findPolicies(capability, component);

    if (policies.length === 0) {
      // No policy = no autonomous action (no scope creep)
      return this.createDeniedResult(
        component,
        capability,
        `no policy found for ${capability} on ${component} — autonomous action denied (no scope creep)`,
        health.evidence,
      );
    }

    // Check circuit breaker
    const circuitBreakerTripped = this.budgetManager.isCircuitBreakerTripped(component);

    // Evaluate each policy
    for (const policy of policies) {
      const evalResult = this.policyModel.evaluate(
        policy,
        health,
        graph,
        circuitBreakerTripped,
      );

      if (!evalResult.allowed) {
        // Log the policy denial
        this.stateModel.logEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'action_denied',
          component,
          cause: evalResult.reason,
          action: capability,
          actionResult: 'denied',
          detail: {
            policyId: policy.id,
            risk: policy.risk,
            conditionsFailed: evalResult.conditionsFailed,
          },
        });

        // If circuit breaker tripped, escalate
        if (circuitBreakerTripped) {
          return this.createEscalationResult(component, evalResult.reason);
        }

        continue; // try next policy
      }

      // Policy allows — check budget
      const budgetCheck = this.budgetManager.canRecover(component, incidentId);
      if (!budgetCheck.allowed) {
        this.stateModel.logEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'budget_exhausted',
          component,
          cause: budgetCheck.reason,
          action: capability,
          actionResult: 'denied',
        });
        return this.createEscalationResult(component, budgetCheck.reason);
      }

      // Check capability authorization
      const auth = this.authorizer.authorize(capability, {
        requester: 'action-selector',
        target: component,
      });

      if (!auth.authorized) {
        return this.createDeniedResult(
          component,
          capability,
          auth.reason ?? 'authorization denied',
          health.evidence,
        );
      }

      // Action is selected and authorized
      const candidate: CandidateAction = {
        capability,
        target: component,
        risk: policy.risk,
        reason: `policy ${policy.id} allows recovery: ${evalResult.reason}`,
        evidence: health.evidence,
        confidence: this.estimateConfidence(health, graph),
        source: 'deterministic',
      };

      // Log the selection
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'action_selected',
        component,
        cause: candidate.reason,
        action: capability,
        actionResult: dryRun ? 'skipped' : 'success',
        detail: {
          policyId: policy.id,
          risk: policy.risk,
          confidence: candidate.confidence,
          dryRun,
        },
      });

      return {
        selected: candidate,
        reason: candidate.reason,
        policy: evalResult,
        authorization: auth,
        alternatives: [],
        dryRun,
      };
    }

    // No policy allowed the action
    return this.createEscalationResult(
      component,
      `no policy allowed recovery for ${component} in state ${health.state}`,
    );
  }

  /**
   * Select an action for a failed dependency (causal recovery).
   */
  private selectActionForDependency(
    dependency: string,
    graph: DependencyGraph,
    incidentId: string,
    dryRun: boolean,
  ): ActionSelectionResult {
    const depHealth = this.stateModel.getState(dependency);
    return this.selectAction(dependency, depHealth, graph, incidentId, dryRun);
  }

  /**
   * Find failed dependencies of a component.
   */
  private findFailedDependencies(health: ComponentHealth, graph: DependencyGraph): string[] {
    const deps = health.dependencies ?? {};
    return Object.entries(deps)
      .filter(([, state]) => state === 'UNAVAILABLE' || state === 'FAILED')
      .map(([id]) => id);
  }

  /**
   * Estimate diagnostic confidence based on evidence quality.
   * This is SEPARATE from authorization — confidence ≠ authorization.
   */
  private estimateConfidence(health: ComponentHealth, _graph: DependencyGraph): number {
    let confidence = 50; // base

    // More evidence = higher confidence
    if (health.evidence.length >= 3) confidence += 20;
    if (health.evidence.length >= 5) confidence += 10;

    // Specific evidence types increase confidence
    const hasPortCheck = health.evidence.some((e) => e.check === 'port-listening');
    const hasProcessCheck = health.evidence.some((e) => e.check === 'process-identity');
    const hasHealthCheck = health.evidence.some((e) => e.check === 'health-endpoint');

    if (hasPortCheck) confidence += 5;
    if (hasProcessCheck) confidence += 5;
    if (hasHealthCheck) confidence += 5;

    // Clear failure evidence increases confidence in the diagnosis
    const hasFailEvidence = health.evidence.some((e) => e.status === 'fail');
    if (hasFailEvidence) confidence += 5;

    return Math.min(confidence, 100);
  }

  // --- Result constructors ---

  private createNoActionResult(component: string, reason: string): ActionSelectionResult {
    return {
      selected: null,
      reason,
      policy: {
        policy: {
          id: 'no-action',
          capability: 'health.read',
          target: component,
          risk: 'R0',
          authorization: 'autonomous',
          allowedWhen: [],
          maxAttempts: 0,
          cooldownMs: 0,
          requiredEvidence: [],
          escalationAction: 'none',
          description: 'No action needed',
        },
        allowed: true,
        reason,
        conditionsMet: [],
        conditionsFailed: [],
        risk: 'R0',
        authorization: 'autonomous',
      },
      authorization: { capability: 'health.read', authorized: true, scope: ['*'] },
      alternatives: [],
      dryRun: false,
    };
  }

  private createDeniedResult(
    component: string,
    capability: Capability,
    reason: string,
    evidence: HealthEvidence[],
  ): ActionSelectionResult {
    return {
      selected: null,
      reason: `DENIED: ${reason}`,
      policy: {
        policy: {
          id: 'denied',
          capability,
          target: component,
          risk: 'R5',
          authorization: 'prohibited',
          allowedWhen: [],
          maxAttempts: 0,
          cooldownMs: 0,
          requiredEvidence: [],
          escalationAction: 'human_review',
          description: 'Action denied',
        },
        allowed: false,
        reason,
        conditionsMet: [],
        conditionsFailed: [],
        risk: 'R5',
        authorization: 'prohibited',
      },
      authorization: { capability, authorized: false, reason, scope: [] },
      alternatives: [],
      dryRun: false,
    };
  }

  private createEscalationResult(component: string, reason: string): ActionSelectionResult {
    return {
      selected: null,
      reason: `ESCALATION_REQUIRED: ${reason}`,
      policy: {
        policy: {
          id: 'escalate',
          capability: 'health.recover',
          target: component,
          risk: 'R0',
          authorization: 'autonomous',
          allowedWhen: [],
          maxAttempts: 1,
          cooldownMs: 0,
          requiredEvidence: [],
          escalationAction: 'human_review',
          description: 'Escalate to human operator',
        },
        allowed: true,
        reason,
        conditionsMet: [],
        conditionsFailed: [],
        risk: 'R0',
        authorization: 'autonomous',
      },
      authorization: { capability: 'health.recover', authorized: true, scope: [component] },
      alternatives: [],
      dryRun: false,
    };
  }
}
