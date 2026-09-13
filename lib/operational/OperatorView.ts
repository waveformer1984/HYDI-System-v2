/**
 * HYDI Operator View
 *
 * Phase 4 — One canonical operator view that answers:
 *
 *   What is broken?
 *   Why does Heidi believe it is broken?
 *   What is affected?
 *   What is Heidi allowed to do?
 *   What did Heidi choose?
 *   Why?
 *   What has already been attempted?
 *   Did it work?
 *   What happens next?
 *
 * Does not require the operator to inspect raw JSONL files manually.
 * The underlying evidence remains machine-readable.
 */

import type {
  ComponentHealth,
  ComponentState,
  PolicyDecisionRecord,
  EscalationPackage,
} from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { DependencyGraph } from './types';
import type { PolicyDecisionRecordStore } from './PolicyDecisionRecord';
import type { EscalationManager } from './EscalationManager';
import type { IncidentCorrelator, Incident } from './IncidentCorrelator';
import type { AutonomyPolicyModel } from './AutonomyPolicyModel';
import type { RiskClassifier } from './RiskClassifier';
import type { RecoveryBudgetManager } from './RecoveryBudget';
import type { RecoveryLockManager } from './RecoveryLock';

export class OperatorView {
  private stateModel: SystemStateModel;
  private graph: DependencyGraph;
  private decisionStore: PolicyDecisionRecordStore;
  private escalationManager: EscalationManager;
  private correlator: IncidentCorrelator;
  private policyModel: AutonomyPolicyModel;
  private riskClassifier: RiskClassifier;
  private budgetManager: RecoveryBudgetManager;
  private lockManager: RecoveryLockManager;

  constructor(
    stateModel: SystemStateModel,
    graph: DependencyGraph,
    decisionStore: PolicyDecisionRecordStore,
    escalationManager: EscalationManager,
    correlator: IncidentCorrelator,
    policyModel: AutonomyPolicyModel,
    riskClassifier: RiskClassifier,
    budgetManager: RecoveryBudgetManager,
    lockManager: RecoveryLockManager,
  ) {
    this.stateModel = stateModel;
    this.graph = graph;
    this.decisionStore = decisionStore;
    this.escalationManager = escalationManager;
    this.correlator = correlator;
    this.policyModel = policyModel;
    this.riskClassifier = riskClassifier;
    this.budgetManager = budgetManager;
    this.lockManager = lockManager;
  }

  /**
   * Produce a human-readable operator view.
   */
  produce(): string {
    const allStates = this.stateModel.getAllStates();
    const overallState = this.stateModel.getOverallState();
    const broken = allStates.filter((s) => s.state !== 'HEALTHY' && s.state !== 'UNKNOWN');
    const activeIncidents = this.correlator.getActiveIncidents();
    const escalations = this.escalationManager.getActiveEscalations();
    const recentDecisions = this.decisionStore.getRecent(10);
    const activeLeases = this.lockManager.getActiveLeases();
    const allBreakers = this.budgetManager.getAllCircuitBreakers();

    const lines: string[] = [];
    const sep = '─'.repeat(60);

    lines.push(sep);
    lines.push('HYDI OPERATOR VIEW');
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push(`Overall State: ${overallState}`);
    lines.push(sep);

    // What is broken?
    lines.push('');
    lines.push('WHAT IS BROKEN?');
    if (broken.length === 0) {
      lines.push('  Nothing — all components are HEALTHY or UNKNOWN.');
    } else {
      for (const comp of broken) {
        lines.push(`  ${comp.component}: ${comp.state}`);
        if (comp.error) lines.push(`    error: ${comp.error}`);
      }
    }

    // Why does Heidi believe it is broken?
    lines.push('');
    lines.push('WHY DOES HEIDI BELIEVE IT IS BROKEN?');
    if (broken.length === 0) {
      lines.push('  N/A — system is healthy.');
    } else {
      for (const comp of broken) {
        lines.push(`  ${comp.component}:`);
        for (const e of comp.evidence) {
          if (e.status === 'fail' || e.status === 'warn') {
            lines.push(`    [${e.status}] ${e.check}: ${e.value}`);
          }
        }
      }
    }

    // What is affected?
    lines.push('');
    lines.push('WHAT IS AFFECTED?');
    if (activeIncidents.length === 0) {
      lines.push('  No active incidents.');
    } else {
      for (const inc of activeIncidents) {
        lines.push(`  Incident ${inc.id.substring(0, 8)}:`);
        lines.push(`    root: ${inc.rootComponent} — ${inc.rootCause}`);
        lines.push(`    affected: ${inc.affectedComponents.join(', ')}`);
        if (inc.actions && inc.actions.length > 0) {
          lines.push(`    actions taken: ${inc.actions.length}`);
        }
      }
    }

    // What is Heidi allowed to do?
    lines.push('');
    lines.push('WHAT IS HEIDI ALLOWED TO DO?');
    const policies = this.policyModel.getAllPolicies();
    for (const p of policies) {
      if (p.authorization === 'autonomous' || p.authorization === 'policy_authorized') {
        lines.push(`  ${p.capability} on ${p.target}: ${p.authorization} (risk ${p.risk})`);
      }
    }
    lines.push('  (R3+ actions require human authorization)');

    // What did Heidi choose? Why?
    lines.push('');
    lines.push('WHAT DID HEIDI CHOOSE? (recent decisions)');
    if (recentDecisions.length === 0) {
      lines.push('  No decisions recorded yet.');
    } else {
      for (const d of recentDecisions.slice(-5)) {
        const action = d.selectedAction
          ? `${d.selectedAction.capability} on ${d.selectedAction.target}`
          : 'NO_ACTION';
        lines.push(`  [${d.timestamp.substring(11, 19)}] ${d.component}: ${action} → ${d.result}`);
        lines.push(`    reason: ${d.reason}`);
      }
    }

    // What has already been attempted? Did it work?
    lines.push('');
    lines.push('WHAT HAS BEEN ATTEMPTED?');
    for (const comp of broken) {
      const stats = this.budgetManager.getStats(comp.component);
      const decisions = this.decisionStore.getByComponent(comp.component);
      if (decisions.length === 0 && stats.totalAttempts === 0) {
        lines.push(`  ${comp.component}: nothing attempted yet.`);
      } else {
        lines.push(`  ${comp.component}: ${stats.totalAttempts} attempt(s), ${stats.totalSuccesses} success(es)`);
        if (stats.circuitBreakerTripped) {
          lines.push(`    ⚠ CIRCUIT BREAKER TRIPPED (${stats.consecutiveFailures} consecutive failures)`);
        }
        for (const d of decisions.slice(-3)) {
          lines.push(`    [${d.timestamp.substring(11, 19)}] ${d.result}: ${d.reason}`);
        }
      }
    }

    // What happens next?
    lines.push('');
    lines.push('WHAT HAPPENS NEXT?');
    if (escalations.length > 0) {
      lines.push('  ⚠ ESCALATION REQUIRED — human intervention needed:');
      for (const esc of escalations) {
        lines.push(`    ${esc.component}: ${esc.policyStoppedReason}`);
        lines.push(`    recommended: ${esc.recommendedNextAction}`);
      }
    } else if (broken.length === 0) {
      lines.push('  System is healthy — monitoring.');
    } else {
      for (const comp of broken) {
        const stats = this.budgetManager.getStats(comp.component);
        if (stats.circuitBreakerTripped) {
          lines.push(`  ${comp.component}: circuit breaker tripped — will escalate`);
        } else if (stats.retries >= stats.maxRetries) {
          lines.push(`  ${comp.component}: retry budget exhausted — will escalate`);
        } else {
          lines.push(`  ${comp.component}: will attempt recovery (${stats.retries}/${stats.maxRetries} retries used)`);
        }
      }
    }

    // Active recovery locks
    if (activeLeases.length > 0) {
      lines.push('');
      lines.push('ACTIVE RECOVERY LOCKS:');
      for (const lease of activeLeases) {
        lines.push(`  ${lease.component} (holder: ${lease.holderId.substring(0, 8)}, expires: ${lease.expiresAt})`);
      }
    }

    // Circuit breakers
    const trippedBreakers = allBreakers.filter((b) => b.tripped);
    if (trippedBreakers.length > 0) {
      lines.push('');
      lines.push('CIRCUIT BREAKERS:');
      for (const b of trippedBreakers) {
        lines.push(`  ${b.component}: TRIPPED (${b.consecutiveFailures} consecutive failures)`);
      }
    }

    lines.push('');
    lines.push(sep);

    return lines.join('\n');
  }
}
