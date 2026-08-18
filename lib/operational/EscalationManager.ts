/**
 * HYDI Escalation Manager
 *
 * Phase 4 — Creates operator-readable escalation packages when recovery
 * is exhausted or an action is denied.
 *
 * An escalation is NOT just "Recovery failed." It contains:
 *   - The incident and evidence
 *   - What was attempted and what happened
 *   - Why policy stopped further action
 *   - Recommended next action
 *   - Risk level and affected components
 *
 * Escalation state: ESCALATION_REQUIRED
 * The component stays in this state until a human intervenes or
 * explicitly authorizes further action.
 */

import { randomUUID } from 'crypto';
import type {
  EscalationPackage,
  ComponentState,
  HealthEvidence,
  RiskLevel,
  OperationalEvent,
} from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { PolicyDecisionRecordStore } from './PolicyDecisionRecord';

export class EscalationManager {
  private stateModel: SystemStateModel;
  private decisionStore: PolicyDecisionRecordStore;
  private activeEscalations = new Map<string, EscalationPackage>();

  constructor(stateModel: SystemStateModel, decisionStore: PolicyDecisionRecordStore) {
    this.stateModel = stateModel;
    this.decisionStore = decisionStore;
  }

  /**
   * Create an escalation for a component.
   * Sets the component state to ESCALATION_REQUIRED and produces an
   * operator-readable escalation package.
   */
  escalate(
    component: string,
    incidentId: string,
    correlationId: string,
    evidence: HealthEvidence[],
    attemptedActions: EscalationPackage['attemptedActions'],
    policyStoppedReason: string,
    recommendedNextAction: string,
    risk: RiskLevel,
    affectedComponents: string[],
  ): EscalationPackage {
    const escalation: EscalationPackage = {
      escalationId: randomUUID(),
      incidentId,
      component,
      state: 'ESCALATION_REQUIRED',
      evidence,
      attemptedActions,
      policyStoppedReason,
      recommendedNextAction,
      risk,
      affectedComponents,
      timestamp: new Date().toISOString(),
    };

    // Set component state to ESCALATION_REQUIRED
    this.stateModel.updateState(component, 'ESCALATION_REQUIRED', [
      {
        check: 'escalation',
        status: 'fail',
        value: 'recovery exhausted — human intervention required',
        detail: policyStoppedReason,
        checkedAt: escalation.timestamp,
      },
    ]);

    // Log the escalation event
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: escalation.timestamp,
      type: 'escalation_triggered',
      component,
      cause: policyStoppedReason,
      action: 'escalate',
      actionResult: 'denied',
      correlationId,
      detail: {
        escalationId: escalation.escalationId,
        incidentId,
        recommendedNextAction,
        risk,
        affectedComponents,
      },
    });

    this.activeEscalations.set(component, escalation);

    return escalation;
  }

  /**
   * Get the active escalation for a component (if any).
   */
  getEscalation(component: string): EscalationPackage | null {
    return this.activeEscalations.get(component) ?? null;
  }

  /**
   * Get all active escalations.
   */
  getActiveEscalations(): EscalationPackage[] {
    return Array.from(this.activeEscalations.values());
  }

  /**
   * Clear an escalation (when human intervenes or component recovers).
   */
  clearEscalation(component: string): void {
    this.activeEscalations.delete(component);
  }

  /**
   * Check if a component has an active escalation.
   */
  isEscalated(component: string): boolean {
    return this.activeEscalations.has(component);
  }

  /**
   * Produce a human-readable escalation report.
   */
  formatEscalation(escalation: EscalationPackage): string {
    const lines: string[] = [
      '═══════════════════════════════════════════════════════════',
      'ESCALATION REQUIRED — Human Intervention Needed',
      '═══════════════════════════════════════════════════════════',
      '',
      `Component:       ${escalation.component}`,
      `Incident ID:     ${escalation.incidentId}`,
      `Escalation ID:   ${escalation.escalationId}`,
      `Timestamp:       ${escalation.timestamp}`,
      `Risk Level:      ${escalation.risk}`,
      '',
      'AFFECTED COMPONENTS:',
      ...escalation.affectedComponents.map((c) => `  - ${c}`),
      '',
      'EVIDENCE:',
      ...escalation.evidence.map((e) => `  [${e.status}] ${e.check}: ${e.value}`),
      '',
      'ATTEMPTED ACTIONS:',
      ...escalation.attemptedActions.map(
        (a) => `  - ${a.action}: ${a.result} (${a.timestamp})${a.error ? ` — ${a.error}` : ''}`,
      ),
      '',
      `POLICY STOPPED:  ${escalation.policyStoppedReason}`,
      `RECOMMENDED:     ${escalation.recommendedNextAction}`,
      '',
      '═══════════════════════════════════════════════════════════',
    ];
    return lines.join('\n');
  }
}
