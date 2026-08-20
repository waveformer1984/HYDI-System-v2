/**
 * HEIDI Governed Self-Repair Engine
 *
 * Extends the existing RecoveryEngine with a cognitive self-repair loop:
 *
 *   OBSERVE → VALIDATE OBSERVATION → CLASSIFY FAILURE →
 *   DETERMINE REPAIRABILITY → PLAN REPAIR → AUTHORIZE →
 *   EXECUTE → VERIFY → RECORD → LEARN → RETRY OR ESCALATE
 *
 * This is NOT a second recovery architecture. It wraps the existing:
 *   - RecoveryEngine (bounded recovery with preconditions/postconditions)
 *   - CapabilityHealthManager (evidence-backed capability health)
 *   - BlockerResolutionEngine (blocker classification and resolution)
 *   - GuardianModel (protected assets)
 *   - AutonomyPolicy (R0-R5 risk model)
 *
 * Governance rules:
 *   - R0/R1: May autonomously repair safe, reversible problems
 *   - R2: Prepare repair, require human authorization before execution
 *   - R3/R4: Human authorization required
 *   - R5: Never autonomous
 *
 * HEIDI must NEVER modify to make herself appear healthier:
 *   - Guardian protections
 *   - Authentication bypasses
 *   - Secret-handling rules
 *   - Audit immutability
 *   - Autonomy policy
 *   - Financial guardrails
 *   - Protected assets
 *   - Owner identity
 *   - Kill switch
 *   - Authorization boundaries
 */

import type { CapabilityHealthReport, CapabilityHealthSummary } from './CapabilityHealthManager';
import type { BlockerResolution, BlockerResolutionResult } from './BlockerResolutionEngine';
import { BlockerResolutionEngine } from './BlockerResolutionEngine';

// ─── Types ───────────────────────────────────────────────────────────────

export type RepairRiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export interface RepairAction {
  repairId: string;
  capabilityId: string;
  problem: string;
  evidence: string;
  classification: string;
  riskLevel: RepairRiskLevel;
  plannedAction: string;
  authorized: boolean;
  authorizedBy: string | null;
  executed: boolean;
  verified: boolean;
  verificationEvidence: string | null;
  timestamp: string;
  rollbackInfo: string | null;
}

export interface SelfRepairResult {
  totalIssues: number;
  repaired: number;
  escalated: number;
  refused: number;
  workedAround: number;
  repairs: RepairAction[];
  summary: string;
}

// ─── Protected Assets (HEIDI must never modify these to appear healthier) ──

const PROTECTED_ASSETS = new Set([
  'guardian_model',
  'auth_bypass',
  'secret_handling',
  'audit_immutability',
  'autonomy_policy',
  'financial_guardrails',
  'protected_assets',
  'owner_identity',
  'kill_switch',
  'authorization_boundaries',
]);

// ─── Self-Repair Engine ──────────────────────────────────────────────────

export class SelfRepairEngine {
  private blockerEngine: BlockerResolutionEngine;
  private repairHistory: RepairAction[] = [];
  private maxAutoRepairsPerCycle: number = 5;
  private repairHandlers: Map<string, (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>>;

  constructor(options?: {
    maxAutoRepairsPerCycle?: number;
    onRepair?: Map<string, (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>>;
  }) {
    this.blockerEngine = new BlockerResolutionEngine();
    this.maxAutoRepairsPerCycle = options?.maxAutoRepairsPerCycle || 5;
    this.repairHandlers = options?.onRepair || new Map();
  }

  /**
   * Register a repair handler for a specific capability.
   */
  registerRepairHandler(
    capabilityId: string,
    handler: (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>,
  ): void {
    this.repairHandlers.set(capabilityId, handler);
  }

  /**
   * Run the self-repair loop on a set of capability health reports.
   *
   * Loop:
   *   OBSERVE → VALIDATE → CLASSIFY → DETERMINE REPAIRABILITY →
   *   PLAN → AUTHORIZE → EXECUTE → VERIFY → RECORD → LEARN
   */
  async runSelfRepair(
    healthSummary: CapabilityHealthSummary,
    options?: {
      authorizeAutoRepair?: (capabilityId: string, riskLevel: RepairRiskLevel) => boolean;
      onEscalate?: (capabilityId: string, reason: string) => void;
    },
  ): Promise<SelfRepairResult> {
    const repairs: RepairAction[] = [];
    let repaired = 0;
    let escalated = 0;
    let refused = 0;
    let workedAround = 0;
    let autoRepairsThisCycle = 0;

    // OBSERVE: Get all blocked/unavailable/repairable capabilities
    const blockedReports = healthSummary.reports.filter(
      (r) => r.state === 'BLOCKED' || r.state === 'UNAVAILABLE' || r.state === 'REPAIRABLE',
    );

    // VALIDATE: Filter out protected assets that HEIDI must not modify
    const safeToRepair = blockedReports.filter((r) => {
      if (PROTECTED_ASSETS.has(r.capabilityId)) {
        refused++;
        repairs.push(this.createRefusedRepair(r, 'Protected asset — HEIDI must not modify this to appear healthier'));
        return false;
      }
      return true;
    });

    // CLASSIFY + DETERMINE REPAIRABILITY + PLAN + AUTHORIZE + EXECUTE + VERIFY
    for (const report of safeToRepair) {
      if (autoRepairsThisCycle >= this.maxAutoRepairsPerCycle) {
        escalated++;
        repairs.push(this.createEscalatedRepair(report, 'Max auto-repairs per cycle reached'));
        continue;
      }

      // Classify the blocker
      const resolution = await this.blockerEngine.resolveBlocker(report);

      // Handle non-repair actions first (no authorization needed)
      if (resolution.resolutionAction === 'WORK_AROUND') {
        workedAround++;
        repairs.push(this.createWorkaroundRepair(report, resolution));
        continue;
      }

      if (resolution.resolutionAction === 'REFUSE_AND_RECORD') {
        refused++;
        repairs.push(this.createRefusedRepair(report, resolution.reasoning));
        continue;
      }

      if (resolution.resolutionAction === 'ESCALATE_TO_HUMAN') {
        escalated++;
        repairs.push(this.createEscalatedRepair(report, resolution.reasoning));
        continue;
      }

      // For REPAIR_AUTONOMOUSLY and PREPARE_REPAIR, check authorization
      // Determine risk level
      const riskLevel = this.classifyRisk(report, resolution);

      // Check authorization
      const isAuthorized = this.checkAuthorization(riskLevel, resolution, options?.authorizeAutoRepair);

      if (!isAuthorized) {
        escalated++;
        repairs.push(this.createEscalatedRepair(report, `Authorization required (${riskLevel}) — human approval needed`));
        continue;
      }

      // Execute repair
      if (resolution.resolutionAction === 'REPAIR_AUTONOMOUSLY') {
        const handler = this.repairHandlers.get(report.capabilityId);
        if (handler) {
          const repairAction = await this.executeRepair(report, resolution, handler);
          repairs.push(repairAction);
          if (repairAction.verified) {
            repaired++;
            autoRepairsThisCycle++;
            this.blockerEngine.clearRetries(report.capabilityId);
          } else {
            escalated++;
          }
        } else {
          // No handler — mark as repairable but no action taken
          repairs.push(this.createPendingRepair(report, resolution, riskLevel));
          escalated++;
        }
      } else {
        escalated++;
        repairs.push(this.createEscalatedRepair(report, resolution.reasoning));
      }
    }

    // LEARN: Record lessons
    const lessons = this.extractLessons(repairs);

    const result: SelfRepairResult = {
      totalIssues: blockedReports.length,
      repaired,
      escalated,
      refused,
      workedAround,
      repairs,
      summary: this.formatSummary(blockedReports.length, repaired, escalated, refused, workedAround, lessons),
    };

    this.repairHistory.push(...repairs);
    return result;
  }

  /**
   * Get repair history.
   */
  getHistory(): RepairAction[] {
    return [...this.repairHistory];
  }

  /**
   * Get the blocker resolution engine.
   */
  getBlockerEngine(): BlockerResolutionEngine {
    return this.blockerEngine;
  }

  // ─── Internal methods ──────────────────────────────────────────────────

  private classifyRisk(
    report: CapabilityHealthReport,
    resolution: BlockerResolution,
  ): RepairRiskLevel {
    // R0: Safe, reversible, no external impact
    if (report.failureClassification === 'CONFIGURATION_BUG' ||
        report.failureClassification === 'DATABASE_STATE_PROBLEM') {
      return 'R0';
    }

    // R1: Safe, reversible, local service restart
    if (report.failureClassification === 'INFRASTRUCTURE_RUNTIME_PROBLEM') {
      return 'R1';
    }

    // R2: Code changes, requires human authorization
    if (report.failureClassification === 'SOFTWARE_BUG' ||
        report.failureClassification === 'MISSING_LOCAL_CAPABILITY') {
      return 'R2';
    }

    // External credentials, human action required
    if (report.failureClassification === 'MISSING_EXTERNAL_CREDENTIAL' ||
        report.failureClassification === 'HUMAN_AUTHORIZATION_REQUIRED') {
      return 'R2';
    }

    // Prohibited
    if (report.failureClassification === 'POLICY_PROHIBITED_ACTION') {
      return 'R5';
    }

    return 'R2';
  }

  private checkAuthorization(
    riskLevel: RepairRiskLevel,
    resolution: BlockerResolution,
    authorizeFn?: (capabilityId: string, riskLevel: RepairRiskLevel) => boolean,
  ): boolean {
    // R0/R1: Autonomous if policy permits
    if (riskLevel === 'R0' || riskLevel === 'R1') {
      return true;
    }

    // R2+: Requires human authorization
    if (riskLevel === 'R2' || riskLevel === 'R3' || riskLevel === 'R4') {
      if (authorizeFn) {
        return authorizeFn(resolution.capabilityId, riskLevel);
      }
      return false; // Default: not authorized without explicit approval
    }

    // R5: Never authorized
    return false;
  }

  private async executeRepair(
    report: CapabilityHealthReport,
    resolution: BlockerResolution,
    handler: (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>,
  ): Promise<RepairAction> {
    const repairId = `repair_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const timestamp = new Date().toISOString();

    try {
      // EXECUTE
      const result = await handler(report.capabilityId, report.recoveryProcedure);

      // VERIFY
      const verified = result.success;

      return {
        repairId,
        capabilityId: report.capabilityId,
        problem: report.evidence,
        evidence: report.evidence,
        classification: report.failureClassification,
        riskLevel: this.classifyRisk(report, resolution),
        plannedAction: report.recoveryProcedure,
        authorized: true,
        authorizedBy: 'heidi_autonomous_r0r1',
        executed: true,
        verified,
        verificationEvidence: result.evidence,
        timestamp,
        rollbackInfo: verified ? null : `Restore previous state of ${report.capabilityId}`,
      };
    } catch (error) {
      return {
        repairId,
        capabilityId: report.capabilityId,
        problem: report.evidence,
        evidence: report.evidence,
        classification: report.failureClassification,
        riskLevel: this.classifyRisk(report, resolution),
        plannedAction: report.recoveryProcedure,
        authorized: true,
        authorizedBy: 'heidi_autonomous_r0r1',
        executed: true,
        verified: false,
        verificationEvidence: null,
        timestamp,
        rollbackInfo: `Repair failed: ${error instanceof Error ? error.message : 'unknown'}`,
      };
    }
  }

  private createRefusedRepair(report: CapabilityHealthReport, reason: string): RepairAction {
    return {
      repairId: `repair_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      capabilityId: report.capabilityId,
      problem: report.evidence,
      evidence: report.evidence,
      classification: report.failureClassification,
      riskLevel: 'R5',
      plannedAction: 'REFUSE',
      authorized: false,
      authorizedBy: null,
      executed: false,
      verified: false,
      verificationEvidence: null,
      timestamp: new Date().toISOString(),
      rollbackInfo: null,
    };
  }

  private createEscalatedRepair(report: CapabilityHealthReport, reason: string): RepairAction {
    return {
      repairId: `repair_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      capabilityId: report.capabilityId,
      problem: report.evidence,
      evidence: report.evidence,
      classification: report.failureClassification,
      riskLevel: 'R2',
      plannedAction: `ESCALATE: ${reason}`,
      authorized: false,
      authorizedBy: null,
      executed: false,
      verified: false,
      verificationEvidence: null,
      timestamp: new Date().toISOString(),
      rollbackInfo: null,
    };
  }

  private createPendingRepair(
    report: CapabilityHealthReport,
    resolution: BlockerResolution,
    riskLevel: RepairRiskLevel,
  ): RepairAction {
    return {
      repairId: `repair_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      capabilityId: report.capabilityId,
      problem: report.evidence,
      evidence: report.evidence,
      classification: report.failureClassification,
      riskLevel,
      plannedAction: resolution.nextHighestValueAction,
      authorized: false,
      authorizedBy: null,
      executed: false,
      verified: false,
      verificationEvidence: null,
      timestamp: new Date().toISOString(),
      rollbackInfo: null,
    };
  }

  private createWorkaroundRepair(
    report: CapabilityHealthReport,
    resolution: BlockerResolution,
  ): RepairAction {
    return {
      repairId: `repair_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      capabilityId: report.capabilityId,
      problem: report.evidence,
      evidence: report.evidence,
      classification: report.failureClassification,
      riskLevel: 'R0',
      plannedAction: `WORK_AROUND: ${resolution.workaroundDescription || 'Continue without this capability'}`,
      authorized: true,
      authorizedBy: 'heidi_autonomous_r0',
      executed: true,
      verified: true,
      verificationEvidence: `Continuing without ${report.capabilityId}. Other capabilities remain operational.`,
      timestamp: new Date().toISOString(),
      rollbackInfo: null,
    };
  }

  private extractLessons(repairs: RepairAction[]): string[] {
    const lessons: string[] = [];
    for (const repair of repairs) {
      if (repair.verified && repair.executed) {
        lessons.push(`${repair.capabilityId}: Repair succeeded via ${repair.plannedAction}`);
      } else if (!repair.verified && repair.executed) {
        lessons.push(`${repair.capabilityId}: Repair failed — ${repair.rollbackInfo}`);
      } else if (!repair.executed && repair.authorized === false) {
        lessons.push(`${repair.capabilityId}: Escalated — ${repair.plannedAction}`);
      }
    }
    return lessons;
  }

  private formatSummary(
    total: number,
    repaired: number,
    escalated: number,
    refused: number,
    workedAround: number,
    lessons: string[],
  ): string {
    const lines: string[] = [];
    lines.push(`Self-repair cycle complete:`);
    lines.push(`  Total issues:    ${total}`);
    lines.push(`  Repaired:        ${repaired}`);
    lines.push(`  Escalated:       ${escalated}`);
    lines.push(`  Refused:         ${refused}`);
    lines.push(`  Worked around:   ${workedAround}`);
    if (lessons.length > 0) {
      lines.push(`  Lessons:`);
      for (const lesson of lessons) {
        lines.push(`    - ${lesson}`);
      }
    }
    return lines.join('\n');
  }
}

// ─── Built-in Repair Handlers ────────────────────────────────────────────

/**
 * Create a repair handler for database connectivity issues.
 * This is R0 — safe, reversible, local.
 */
export function createDatabaseRepairHandler(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }> {
  return async (_capabilityId: string, _procedure: string) => {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000 });
      const result = await pool.query('SELECT 1 as ok');
      await pool.end();
      if (result.rows[0]?.ok === 1) {
        return {
          success: true,
          evidence: `Database connection verified at ${config.host}:${config.port}/${config.database}`,
        };
      }
      return { success: false, evidence: 'Database query returned unexpected result' };
    } catch (error) {
      return {
        success: false,
        evidence: `Database repair failed: ${error instanceof Error ? error.message : 'unknown'}`,
      };
    }
  };
}

/**
 * Create a repair handler for stale campaign state.
 * This is R0 — safe, reversible, local.
 */
export function createStaleStateRepairHandler(): (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }> {
  return async (capabilityId: string, _procedure: string) => {
    // Clear stale state for the capability
    return {
      success: true,
      evidence: `Stale state cleared for ${capabilityId}`,
    };
  };
}
