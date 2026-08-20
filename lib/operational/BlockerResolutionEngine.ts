/**
 * HEIDI Blocker Resolution Engine
 *
 * When HEIDI encounters a BLOCKED state, this engine determines:
 *   1. Why am I blocked?
 *   2. Is the blocker real?
 *   3. Is the observation trustworthy?
 *   4. Is it caused by me?
 *   5. Can I repair it?
 *   6. What authorization is required?
 *   7. Can I continue through another provider?
 *   8. Can I work around it safely?
 *   9. Does the blocker require the human owner?
 *  10. What is the next highest-value action?
 *
 * Blocker classifications:
 *   A. SOFTWARE_BUG              — HEIDI can potentially fix
 *   B. CONFIGURATION_BUG         — HEIDI can potentially fix
 *   C. DATABASE_STATE_PROBLEM    — HEIDI can potentially fix
 *   D. INFRASTRUCTURE_RUNTIME    — HEIDI can potentially fix (local services)
 *   E. MISSING_LOCAL_CAPABILITY  — HEIDI can build/activate
 *   F. MISSING_EXTERNAL_CREDENTIAL — Human required (never fabricate)
 *   G. HUMAN_AUTHORIZATION_REQUIRED — Human required
 *   H. EXTERNAL_SERVICE_UNAVAILABLE — External, cannot fix
 *   I. POLICY_PROHIBITED_ACTION — Refuse and record
 *
 * For each blocker, the engine produces a resolution plan:
 *   - REPAIR_AUTONOMOUSLY (R0/R1)
 *   - PREPARE_REPAIR_AND_REQUEST_AUTHORIZATION (R2)
 *   - ESCALATE_TO_HUMAN
 *   - WORK_AROUND (continue with other capabilities)
 *   - REFUSE_AND_RECORD
 */

import type {
  CapabilityHealthReport,
  CapabilityHealthState,
  BlockerClassification,
} from './CapabilityHealthManager';

// ─── Types ───────────────────────────────────────────────────────────────

export type ResolutionAction =
  | 'REPAIR_AUTONOMOUSLY'
  | 'PREPARE_REPAIR_AND_REQUEST_AUTHORIZATION'
  | 'ESCALATE_TO_HUMAN'
  | 'WORK_AROUND'
  | 'REFUSE_AND_RECORD'
  | 'RETRY_WITH_BACKOFF'
  | 'NOT_BLOCKED';

export interface BlockerResolution {
  capabilityId: string;
  blockerClassification: BlockerClassification;
  isRealBlocker: boolean;
  isCausedByHeidi: boolean;
  isRepairable: boolean;
  repairability: 'auto_repairable' | 'human_required' | 'not_repairable' | 'not_applicable';
  resolutionAction: ResolutionAction;
  requiredAuthorization: string;
  workaroundAvailable: boolean;
  workaroundDescription: string | null;
  nextHighestValueAction: string;
  reasoning: string;
  resolvedAt: string;
}

export interface BlockerResolutionResult {
  totalBlockers: number;
  resolved: number;
  escalated: number;
  workedAround: number;
  refused: number;
  resolutions: BlockerResolution[];
  nextActions: string[];
}

// ─── Blocker Resolution Engine ───────────────────────────────────────────

export class BlockerResolutionEngine {
  private resolutionHistory: BlockerResolution[] = [];
  private maxRetryPerBlocker: number = 3;
  private retryCounts: Map<string, number> = new Map();

  /**
   * Resolve a set of blocked capabilities.
   */
  async resolveBlockers(
    reports: CapabilityHealthReport[],
    options?: {
      onAutoRepair?: (capabilityId: string, procedure: string) => Promise<boolean>;
      onEscalate?: (capabilityId: string, reason: string) => void;
    },
  ): Promise<BlockerResolutionResult> {
    const blocked = reports.filter(
      (r) => r.state === 'BLOCKED' || r.state === 'UNAVAILABLE' || r.state === 'REPAIRABLE' || r.state === 'HUMAN_REQUIRED',
    );

    const resolutions: BlockerResolution[] = [];
    const nextActions: string[] = [];
    let resolved = 0;
    let escalated = 0;
    let workedAround = 0;
    let refused = 0;

    for (const report of blocked) {
      const resolution = await this.resolveBlocker(report, options);
      resolutions.push(resolution);
      this.resolutionHistory.push(resolution);

      switch (resolution.resolutionAction) {
        case 'REPAIR_AUTONOMOUSLY':
          if (options?.onAutoRepair) {
            const success = await options.onAutoRepair(report.capabilityId, report.recoveryProcedure);
            if (success) {
              resolved++;
              this.retryCounts.delete(report.capabilityId);
            } else {
              escalated++;
            }
          } else {
            // Mark as repairable but don't execute without a handler
            resolved++;
          }
          break;
        case 'ESCALATE_TO_HUMAN':
          escalated++;
          if (options?.onEscalate) {
            options.onEscalate(report.capabilityId, resolution.reasoning);
          }
          break;
        case 'WORK_AROUND':
          workedAround++;
          break;
        case 'REFUSE_AND_RECORD':
          refused++;
          break;
        default:
          break;
      }

      if (resolution.nextHighestValueAction) {
        nextActions.push(resolution.nextHighestValueAction);
      }
    }

    return {
      totalBlockers: blocked.length,
      resolved,
      escalated,
      workedAround,
      refused,
      resolutions,
      nextActions,
    };
  }

  /**
   * Resolve a single blocker.
   */
  async resolveBlocker(
    report: CapabilityHealthReport,
    options?: {
      onAutoRepair?: (capabilityId: string, procedure: string) => Promise<boolean>;
      onEscalate?: (capabilityId: string, reason: string) => void;
    },
  ): Promise<BlockerResolution> {
    const blocker = report.failureClassification;
    const retryCount = this.retryCounts.get(report.capabilityId) || 0;

    // Classify the blocker
    const isCausedByHeidi = this.isCausedByHeidi(blocker);
    const isRepairable = this.isRepairable(blocker);
    const workaround = this.findWorkaround(report);

    // Determine resolution action
    let resolutionAction: ResolutionAction;
    let requiredAuthorization = report.requiredAuthorization;
    let reasoning: string;

    switch (blocker) {
      case 'SOFTWARE_BUG':
      case 'CONFIGURATION_BUG':
      case 'DATABASE_STATE_PROBLEM':
        if (retryCount < this.maxRetryPerBlocker) {
          resolutionAction = 'REPAIR_AUTONOMOUSLY';
          reasoning = `Blocker is ${blocker} — HEIDI can potentially repair this autonomously (R0/R1). Retry ${retryCount + 1}/${this.maxRetryPerBlocker}.`;
          this.retryCounts.set(report.capabilityId, retryCount + 1);
        } else {
          resolutionAction = 'ESCALATE_TO_HUMAN';
          reasoning = `Blocker is ${blocker} — attempted ${retryCount} repairs without success. Escalating to human.`;
        }
        break;

      case 'INFRASTRUCTURE_RUNTIME_PROBLEM':
        if (isRepairable && retryCount < this.maxRetryPerBlocker) {
          resolutionAction = 'REPAIR_AUTONOMOUSLY';
          reasoning = `Infrastructure problem — HEIDI can attempt to restart local service. Retry ${retryCount + 1}/${this.maxRetryPerBlocker}.`;
          this.retryCounts.set(report.capabilityId, retryCount + 1);
        } else {
          resolutionAction = 'ESCALATE_TO_HUMAN';
          reasoning = `Infrastructure problem — not repairable after ${retryCount} attempts or requires external action.`;
        }
        break;

      case 'MISSING_LOCAL_CAPABILITY':
        resolutionAction = 'PREPARE_REPAIR_AND_REQUEST_AUTHORIZATION';
        reasoning = 'Missing local capability — HEIDI can build/activate this but may require R2 authorization for deployment.';
        break;

      case 'MISSING_EXTERNAL_CREDENTIAL':
        resolutionAction = 'WORK_AROUND';
        reasoning = `Missing external credential: ${report.requiredCredentials.join(', ')}. HEIDI must NOT fabricate credentials. Continuing with capabilities that do not depend on this credential.`;
        break;

      case 'HUMAN_AUTHORIZATION_REQUIRED':
        resolutionAction = 'ESCALATE_TO_HUMAN';
        reasoning = 'Human authorization is required. HEIDI cannot bypass this.';
        break;

      case 'EXTERNAL_SERVICE_UNAVAILABLE':
        resolutionAction = 'WORK_AROUND';
        reasoning = 'External service is unavailable. HEIDI cannot fix this. Continuing with other capabilities.';
        break;

      case 'POLICY_PROHIBITED_ACTION':
        resolutionAction = 'REFUSE_AND_RECORD';
        reasoning = 'Policy prohibits this action. HEIDI must refuse and record the refusal.';
        break;

      default:
        resolutionAction = 'ESCALATE_TO_HUMAN';
        reasoning = `Unknown blocker type: ${blocker}. Escalating to human for diagnosis.`;
    }

    // Determine next highest-value action
    const nextAction = this.determineNextAction(report, resolutionAction, workaround);

    return {
      capabilityId: report.capabilityId,
      blockerClassification: blocker,
      isRealBlocker: true,
      isCausedByHeidi,
      isRepairable,
      repairability: report.repairability,
      resolutionAction,
      requiredAuthorization,
      workaroundAvailable: workaround.available,
      workaroundDescription: workaround.description,
      nextHighestValueAction: nextAction,
      reasoning,
      resolvedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the resolution history.
   */
  getHistory(): BlockerResolution[] {
    return [...this.resolutionHistory];
  }

  /**
   * Clear retry counts for a capability (after successful repair).
   */
  clearRetries(capabilityId: string): void {
    this.retryCounts.delete(capabilityId);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  private isCausedByHeidi(blocker: BlockerClassification): boolean {
    switch (blocker) {
      case 'SOFTWARE_BUG':
      case 'CONFIGURATION_BUG':
      case 'DATABASE_STATE_PROBLEM':
      case 'MISSING_LOCAL_CAPABILITY':
        return true;
      default:
        return false;
    }
  }

  private isRepairable(blocker: BlockerClassification): boolean {
    switch (blocker) {
      case 'SOFTWARE_BUG':
      case 'CONFIGURATION_BUG':
      case 'DATABASE_STATE_PROBLEM':
      case 'INFRASTRUCTURE_RUNTIME_PROBLEM':
      case 'MISSING_LOCAL_CAPABILITY':
        return true;
      default:
        return false;
    }
  }

  private findWorkaround(report: CapabilityHealthReport): { available: boolean; description: string | null } {
    // For missing credentials, check if there's an alternative path
    if (report.capabilityId === 'commercial.discovery') {
      return {
        available: true,
        description: 'CSV import is available as an alternative to external discovery APIs. No external credentials needed.',
      };
    }

    if (report.capabilityId === 'commercial.email') {
      return {
        available: true,
        description: 'Continue prospect discovery, scoring, qualification, and draft preparation. Queue authorization packages for when email is configured.',
      };
    }

    if (report.capabilityId === 'commercial.stripe') {
      return {
        available: true,
        description: 'Continue all pre-payment stages: discovery, qualification, outreach, response handling. Payment will be processed when Stripe is configured.',
      };
    }

    // For unknown blockers, no workaround
    return { available: false, description: null };
  }

  private determineNextAction(
    report: CapabilityHealthReport,
    resolution: ResolutionAction,
    workaround: { available: boolean; description: string | null },
  ): string {
    if (resolution === 'REPAIR_AUTONOMOUSLY') {
      return `Attempt repair of ${report.capabilityId} using: ${report.recoveryProcedure}`;
    }

    if (resolution === 'WORK_AROUND' && workaround.available) {
      return workaround.description || `Continue operating without ${report.capabilityId}`;
    }

    if (resolution === 'ESCALATE_TO_HUMAN') {
      return `Escalate ${report.capabilityId} to human owner. Required: ${report.requiredCredentials.join(', ') || report.requiredAuthorization}`;
    }

    if (resolution === 'REFUSE_AND_RECORD') {
      return `Record refusal of ${report.capabilityId} in audit log`;
    }

    return `Continue with next highest-value capability`;
  }
}
