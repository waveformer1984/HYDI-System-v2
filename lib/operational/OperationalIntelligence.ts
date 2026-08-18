/**
 * HYDI Operational Intelligence Orchestrator
 *
 * Ties together all Phase 3 + Phase 4 components into a single coherent system:
 * - SystemStateModel (component state tracking)
 * - DependencyGraphBuilder (architecture graph)
 * - HealthProvenanceChecker (reality-based health checks)
 * - CapabilityAuthorizer (security boundaries)
 * - RecoveryEngine (bounded recovery)
 * - IncidentCorrelator (root cause analysis)
 * - OperationalMemory (durable event log)
 * - DiagnosticSnapshot (self-diagnostic output)
 *
 * Phase 4 additions:
 * - StateMachine (legal state transitions)
 * - RiskClassifier (R0-R5 risk levels)
 * - AutonomyPolicyModel (what Heidi is allowed to do)
 * - ActionSelector (deterministic action selection)
 * - RecoveryBudgetManager (retry budget + circuit breaker)
 * - RecoveryLockManager (concurrency safety)
 * - PolicyDecisionRecordStore (durable decision audit trail)
 * - EscalationManager (operator-readable escalation packages)
 * - OperatorView (canonical operator experience)
 *
 * This is the entry point for `npm run hydi:diagnose` and `npm run hydi:recover`.
 */

import path from 'path';
import { SystemStateModel } from './SystemStateModel';
import { DependencyGraphBuilder } from './DependencyGraphBuilder';
import { HealthProvenanceChecker } from './HealthProvenanceChecker';
import { CapabilityAuthorizer } from './CapabilityAuthorizer';
import { RecoveryEngine } from './RecoveryEngine';
import { IncidentCorrelator } from './IncidentCorrelator';
import { OperationalMemory } from './OperationalMemory';
import { DiagnosticSnapshot } from './DiagnosticSnapshot';
import { StateMachine, stateMachine } from './StateMachine';
import { RiskClassifier, riskClassifier } from './RiskClassifier';
import { AutonomyPolicyModel, autonomyPolicyModel } from './AutonomyPolicyModel';
import { ActionSelector } from './ActionSelector';
import { RecoveryBudgetManager } from './RecoveryBudget';
import { RecoveryLockManager } from './RecoveryLock';
import { PolicyDecisionRecordStore } from './PolicyDecisionRecord';
import { EscalationManager } from './EscalationManager';
import { OperatorView } from './OperatorView';
import type { ComponentState, OperationalEvent, ActionSelectionResult } from './types';

export class OperationalIntelligence {
  readonly stateModel: SystemStateModel;
  readonly graph;
  readonly healthChecker: HealthProvenanceChecker;
  readonly authorizer: CapabilityAuthorizer;
  readonly recoveryEngine: RecoveryEngine;
  readonly correlator: IncidentCorrelator;
  readonly memory: OperationalMemory;
  readonly diagnostic: DiagnosticSnapshot;

  // Phase 4 components
  readonly stateMachine: StateMachine;
  readonly riskClassifier: RiskClassifier;
  readonly policyModel: AutonomyPolicyModel;
  readonly actionSelector: ActionSelector;
  readonly budgetManager: RecoveryBudgetManager;
  readonly lockManager: RecoveryLockManager;
  readonly decisionStore: PolicyDecisionRecordStore;
  readonly escalationManager: EscalationManager;
  readonly operatorView: OperatorView;

  private root: string;
  private destroyed = false;

  constructor(root?: string) {
    this.root = root ?? path.resolve(__dirname, '..', '..');

    // Build dependency graph from boot.config.json
    const graphBuilder = new DependencyGraphBuilder(this.root);
    this.graph = graphBuilder.build();

    // Initialize state model and register all components
    this.stateModel = new SystemStateModel();
    for (const [id, node] of this.graph.nodes) {
      this.stateModel.registerComponent(id, node.category);
    }

    // Initialize health checker
    this.healthChecker = new HealthProvenanceChecker(this.root, this.stateModel, this.graph);

    // Initialize security
    this.authorizer = new CapabilityAuthorizer(this.stateModel);

    // Phase 4: Initialize state machine, risk classifier, policy model
    this.stateMachine = stateMachine;
    this.riskClassifier = riskClassifier;
    this.policyModel = autonomyPolicyModel;

    // Phase 4: Initialize recovery budget and lock managers
    this.budgetManager = new RecoveryBudgetManager(this.stateModel);
    this.lockManager = new RecoveryLockManager(this.stateModel);

    // Phase 4: Initialize decision record store and escalation manager
    this.decisionStore = new PolicyDecisionRecordStore(this.root);
    this.escalationManager = new EscalationManager(this.stateModel, this.decisionStore);

    // Initialize recovery (Phase 4: pass budget, lock, policy, action selector, escalation)
    this.recoveryEngine = new RecoveryEngine(
      this.root,
      this.stateModel,
      this.graph,
      this.healthChecker,
      this.authorizer,
      this.policyModel,
      this.budgetManager,
      this.lockManager,
      this.escalationManager,
      this.decisionStore,
    );

    // Phase 4: Initialize action selector
    this.actionSelector = new ActionSelector(
      this.policyModel,
      this.riskClassifier,
      this.authorizer,
      this.budgetManager,
      this.stateModel,
    );

    // Initialize incident correlation
    this.correlator = new IncidentCorrelator(this.stateModel, this.graph);

    // Initialize operational memory (durable event log)
    this.memory = new OperationalMemory(this.root);

    // Wire state model events to operational memory and incident correlator
    this.wireEventLog();

    // Initialize diagnostic
    this.diagnostic = new DiagnosticSnapshot(
      this.root,
      this.stateModel,
      this.graph,
      this.healthChecker,
      this.authorizer,
      this.recoveryEngine,
      this.correlator,
      this.memory,
    );

    // Phase 4: Initialize operator view
    this.operatorView = new OperatorView(
      this.stateModel,
      this.graph,
      this.decisionStore,
      this.escalationManager,
      this.correlator,
      this.policyModel,
      this.riskClassifier,
      this.budgetManager,
      this.lockManager,
    );
  }

  /**
   * Run a full health check and return the overall state.
   */
  async checkHealth(): Promise<ComponentState> {
    await this.healthChecker.checkAll();
    return this.stateModel.getOverallState();
  }

  /**
   * Produce a diagnostic snapshot.
   */
  async diagnose(jsonOutput = false): Promise<string> {
    return this.diagnostic.produce(jsonOutput);
  }

  /**
   * Attempt to recover a specific component.
   */
  async recover(component: string, cause: string): Promise<string> {
    const record = await this.recoveryEngine.recover(component, cause);

    // Correlate the incident
    if (record.finalState === 'HEALTHY') {
      this.correlator.resolveIncident(component, `recovered after ${record.attempts.length} attempt(s)`);
    }

    const lines: string[] = [
      `RECOVERY REPORT for ${component}`,
      `  Cause: ${cause}`,
      `  Action: ${record.action.type}`,
      `  Attempts: ${record.attempts.length}`,
      `  Final state: ${record.finalState}`,
    ];

    for (const attempt of record.attempts) {
      lines.push(`  Attempt ${attempt.attemptNumber}: ${attempt.result}`);
      if (attempt.error) lines.push(`    error: ${attempt.error}`);
    }

    if (record.finalState !== 'HEALTHY') {
      lines.push(`  ESCALATION: ${record.action.escalationPath}`);
    }

    return lines.join('\n');
  }

  /**
   * Auto-diagnose and recover: find all unhealthy components and attempt
   * recovery in dependency order (root causes first).
   */
  async autoRecover(): Promise<string> {
    // First, run health checks
    await this.healthChecker.checkAll();

    // Find unhealthy components
    const unhealthy = this.stateModel
      .getAllStates()
      .filter((h) => h.state === 'UNAVAILABLE' || h.state === 'FAILED' || h.state === 'BLOCKED')
      .sort((a, b) => {
        // Sort by recovery order (dependencies first)
        const aNode = this.graph.nodes.get(a.component);
        const bNode = this.graph.nodes.get(b.component);
        return (aNode?.recoveryOrder ?? 999) - (bNode?.recoveryOrder ?? 999);
      });

    if (unhealthy.length === 0) {
      return 'All components healthy — no recovery needed.';
    }

    const lines: string[] = [
      'AUTO-RECOVERY',
      `Found ${unhealthy.length} unhealthy component(s):`,
      ...unhealthy.map((h) => `  ${h.component}: ${h.state}`),
      '',
    ];

    // Attempt recovery for each, in dependency order
    for (const comp of unhealthy) {
      // Skip if already recovered as a dependency of another
      const currentState = this.stateModel.getState(comp.component).state;
      if (currentState === 'HEALTHY') {
        lines.push(`${comp.component}: already healthy (recovered as dependency)`);
        continue;
      }

      lines.push(`Recovering ${comp.component}...`);
      const result = await this.recover(comp.component, `auto-recovery: state was ${comp.state}`);
      lines.push(result, '');
    }

    // Final health check
    await this.healthChecker.checkAll();
    const finalState = this.stateModel.getOverallState();
    lines.push(`FINAL STATE: ${finalState}`);

    return lines.join('\n');
  }

  /**
   * Clean up all resources.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.recoveryEngine.destroy();
    await this.memory.destroy();
    await this.decisionStore.destroy();
  }

  /**
   * Phase 4: Produce the operator view.
   */
  produceOperatorView(): string {
    return this.operatorView.produce();
  }

  /**
   * Phase 4: Dry-run mode — evaluate what would happen without executing.
   * Shows the full decision chain: observe → diagnose → policy → authorize → (no execute)
   */
  async dryRun(component?: string): Promise<string> {
    // Run health checks first
    await this.healthChecker.checkAll();

    const lines: string[] = [
      'DRY RUN — Policy Evaluation (no actions will be executed)',
      `Timestamp: ${new Date().toISOString()}`,
      '',
    ];

    const targets = component
      ? [component]
      : this.stateModel
          .getAllStates()
          .filter((h) => h.state !== 'HEALTHY' && h.state !== 'UNKNOWN')
          .map((h) => h.component);

    if (targets.length === 0) {
      lines.push('All components are HEALTHY or UNKNOWN — no actions to evaluate.');
      return lines.join('\n');
    }

    for (const target of targets) {
      const health = this.stateModel.getState(target);
      const incidentId = this.correlator.getCorrelationId(target) ?? 'no-incident';

      lines.push(`── ${target} (state: ${health.state}) ──`);

      // Run action selection in dry-run mode
      const selection = this.actionSelector.selectAction(
        target,
        health,
        this.graph,
        incidentId,
        true, // dryRun = true
      );

      if (selection.selected) {
        lines.push(`  candidate: ${selection.selected.capability} on ${selection.selected.target}`);
        lines.push(`  risk: ${selection.selected.risk} (${this.riskClassifier.describe(selection.selected.risk)})`);
        lines.push(`  confidence: ${selection.selected.confidence}%`);
        lines.push(`  policy: ${selection.policy.policy.id} — ${selection.policy.reason}`);
        lines.push(`  authorization: ${selection.authorization.authorized ? 'ALLOWED' : 'DENIED'}`);
        lines.push(`  reason: ${selection.reason}`);
        lines.push(`  → WOULD EXECUTE (dry run — no action taken)`);
      } else {
        lines.push(`  candidate: NO_ACTION`);
        lines.push(`  reason: ${selection.reason}`);
        if (selection.authorization.authorized === false && selection.authorization.reason) {
          lines.push(`  authorization: DENIED — ${selection.authorization.reason}`);
        }
        lines.push(`  → WOULD NOT EXECUTE`);
      }
      lines.push('');
    }

    lines.push('DRY RUN COMPLETE — no actions were executed.');
    return lines.join('\n');
  }

  /**
   * Phase 4: Governed recovery — uses policy model, action selector, budgets,
   * locks, and decision records. This is the main Phase 4 recovery entry point.
   */
  async governedRecover(component: string, cause: string): Promise<string> {
    // Run health checks
    await this.healthChecker.checkAll();

    const health = this.stateModel.getState(component);
    const incidentId = this.correlator.getCorrelationId(component) ?? `manual-${Date.now()}`;

    // Use action selector to determine what to do
    const selection = this.actionSelector.selectAction(
      component,
      health,
      this.graph,
      incidentId,
      false, // not dry run
    );

    // Record the decision
    this.decisionStore.record({
      incidentId,
      correlationId: incidentId,
      component,
      observedState: health.state,
      evidence: health.evidence,
      candidateActions: selection.selected ? [selection.selected] : [],
      selectedAction: selection.selected,
      risk: selection.policy.risk,
      policy: selection.policy.policy,
      authorization: selection.authorization,
      executor: 'governed-recovery',
      result: 'pending',
      reason: selection.reason,
    });

    if (!selection.selected) {
      // No action selected — check if escalation is needed
      if (selection.reason.includes('ESCALATION_REQUIRED')) {
        const escalation = this.escalationManager.escalate(
          component,
          incidentId,
          incidentId,
          health.evidence,
          [],
          selection.reason,
          'Review component state and manually intervene or authorize recovery',
          selection.policy.risk,
          [component],
        );
        return this.escalationManager.formatEscalation(escalation);
      }
      return `NO ACTION for ${component}: ${selection.reason}`;
    }

    // Execute recovery through the recovery engine
    const record = await this.recoveryEngine.recover(component, cause);

    // Update the decision record with results
    this.decisionStore.record({
      incidentId,
      correlationId: incidentId,
      component,
      observedState: health.state,
      evidence: health.evidence,
      candidateActions: [selection.selected],
      selectedAction: selection.selected,
      risk: selection.policy.risk,
      policy: selection.policy.policy,
      authorization: selection.authorization,
      executor: 'governed-recovery',
      result: record.finalState === 'HEALTHY' ? 'success' : 'failure',
      reason: selection.reason,
      verification: this.stateModel.getState(component).evidence,
    });

    // Record action in incident correlator
    this.correlator.recordAction(
      component,
      selection.selected.capability,
      record.finalState === 'HEALTHY' ? 'success' : 'failure',
    );

    // Resolve or escalate
    if (record.finalState === 'HEALTHY') {
      this.correlator.resolveIncident(component, `recovered after ${record.attempts.length} attempt(s)`);
      this.budgetManager.resetComponentRetries(component);
      this.escalationManager.clearEscalation(component);
    } else if (record.finalState === 'FAILED' || record.finalState === 'ESCALATION_REQUIRED') {
      this.correlator.escalateIncident(component, `recovery exhausted: ${record.finalState}`);
      const escalation = this.escalationManager.escalate(
        component,
        incidentId,
        incidentId,
        health.evidence,
        record.attempts.map((a) => ({
          action: a.action.type,
          result: a.result,
          timestamp: a.startedAt,
          error: a.error,
        })),
        `recovery budget exhausted after ${record.attempts.length} attempt(s)`,
        'Review component logs, check dependencies, and manually restart or authorize further recovery attempts',
        selection.policy.risk,
        [component],
      );
      return this.escalationManager.formatEscalation(escalation);
    }

    const lines: string[] = [
      `GOVERNED RECOVERY REPORT for ${component}`,
      `  Cause: ${cause}`,
      `  Policy: ${selection.policy.policy.id}`,
      `  Risk: ${selection.policy.risk}`,
      `  Authorization: ${selection.authorization.authorized ? 'ALLOWED' : 'DENIED'}`,
      `  Action: ${record.action.type}`,
      `  Attempts: ${record.attempts.length}`,
      `  Final state: ${record.finalState}`,
    ];

    for (const attempt of record.attempts) {
      lines.push(`  Attempt ${attempt.attemptNumber}: ${attempt.result}`);
      if (attempt.error) lines.push(`    error: ${attempt.error}`);
    }

    if (record.finalState === 'HEALTHY') {
      lines.push(`  ✓ RECOVERY VERIFIED — postcondition checks passed`);
    }

    return lines.join('\n');
  }

  private wireEventLog(): void {
    // Wire the state model's event log to durable operational memory.
    // Every event logged via stateModel.logEvent() (state transitions,
    // recovery events, capability denials, etc.) is forwarded to the
    // durable JSONL store so it survives restarts.
    this.stateModel.setEventForwarder((event) => {
      this.memory.record(event);
    });
  }

  /**
   * Record an operational event to both the state model and durable memory.
   */
  recordEvent(event: OperationalEvent): void {
    this.stateModel.logEvent(event);
    this.memory.record(event);
  }
}
