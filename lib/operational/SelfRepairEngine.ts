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
  private maxHistoryEntries: number = 500;
  private repairHandlers: Map<string, (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>>;
  // Track the last recorded repair per capability+action to dedup consecutive
  // identical workarounds/escalations for still-blocked capabilities. Without
  // this, a capability that stays blocked indefinitely (e.g. missing Stripe
  // credentials) gets a fresh history entry every cycle — ~1,440/day at 60s
  // intervals — causing unbounded memory growth in the daemon.
  private lastRecordedByKey: Map<string, RepairAction> = new Map();

  // ─── Cross-cycle flapping guardrail ───────────────────────────────
  // Without this, two capabilities whose repair handlers perturb each
  // other can oscillate indefinitely: each cycle does 1 repair (under
  // the per-cycle cap), but the system never converges. The guardrail
  // tracks repair attempts per capabilityId across cycles and stops
  // auto-repairing after flappingThreshold repairs within
  // flappingWindowCycles cycles, escalating instead.
  private cycleCount: number = 0;
  private flappingThreshold: number;
  private flappingWindowCycles: number;
  // Map<capabilityId, number[]> — cycle numbers when a repair was
  // attempted for this capability. Used to detect flapping.
  private repairCyclesByCapability: Map<string, number[]> = new Map();
  // Set<capabilityId> — capabilities currently flagged as flapping.
  // Cleared only by clearFlappingFlag() (e.g. after a manual reset or
  // after the capability stays READY for flappingWindowCycles cycles).
  private flappingCapabilities: Set<string> = new Set();

  private verifyRepairFn?: (capabilityId: string) => Promise<{ healthy: boolean; evidence: string }>;

  constructor(options?: {
    maxAutoRepairsPerCycle?: number;
    onRepair?: Map<string, (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>>;
    maxHistoryEntries?: number;
    /** Stop auto-repairing after this many repairs within flappingWindowCycles. Default: Infinity (disabled). */
    flappingThreshold?: number;
    /** Rolling window (in cycles) for flapping detection. Default: 10. */
    flappingWindowCycles?: number;
    /** Independent post-repair verification function. If provided, repairs
     *  are only marked verified if BOTH the handler returns success AND
     *  this function confirms the capability is healthy. */
    verifyRepair?: (capabilityId: string) => Promise<{ healthy: boolean; evidence: string }>;
  }) {
    this.blockerEngine = new BlockerResolutionEngine();
    this.maxAutoRepairsPerCycle = options?.maxAutoRepairsPerCycle || 5;
    this.repairHandlers = options?.onRepair || new Map();
    this.maxHistoryEntries = options?.maxHistoryEntries || 500;
    this.verifyRepairFn = options?.verifyRepair;
    // Default: flapping detection disabled (Infinity threshold) to
    // preserve backward compatibility for existing callers that don't
    // pass the new options. The daemon and tests opt in explicitly.
    this.flappingThreshold = options?.flappingThreshold ?? Infinity;
    this.flappingWindowCycles = options?.flappingWindowCycles ?? 10;
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

    // Increment the cross-cycle counter. This is used by the flapping
    // guardrail to track repair frequency per capability over time.
    this.cycleCount++;

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

      // Cross-cycle flapping guardrail: if this capability has already
      // been flagged as flapping (too many repairs that didn't stick
      // within the rolling window), stop auto-repairing and escalate.
      // This catches the case where two capabilities perturb each
      // other — each individual cycle stays under the per-cycle cap,
      // but the system oscillates indefinitely across cycles.
      if (this.flappingCapabilities.has(report.capabilityId)) {
        escalated++;
        repairs.push(this.createFlappingRepair(report));
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

            // Record this repair cycle for flapping detection.
            // If the capability has been repaired >= flappingThreshold
            // times within flappingWindowCycles cycles, flag it as
            // flapping so future cycles escalate instead of retrying.
            this.recordRepairForFlapping(report.capabilityId);
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

    // Record to history with dedup + cap:
    // - For non-repair actions (WORK_AROUND, ESCALATE, REFUSE) that repeat
    //   identically for the same still-blocked capability, only record the
    //   first occurrence and update its timestamp. This prevents unbounded
    //   growth from capabilities that stay blocked indefinitely (e.g. missing
    //   Stripe/SendGrid credentials at 60s intervals = ~1,440 entries/day).
    // - For actual repairs (where a repair handler was invoked), always
    //   record — they represent real attempted work.
    // - Cap total history to maxHistoryEntries (rolling window).
    for (const repair of repairs) {
      const isNonRepairAction = this.isNonRepairAction(repair);
      const dedupKey = this.dedupKey(repair);

      if (!isNonRepairAction) {
        // Actual repair — always record
        this.repairHistory.push(repair);
        this.lastRecordedByKey.set(dedupKey, repair);
      } else {
        // Non-repair action (workaround/escalation/refusal)
        const last = this.lastRecordedByKey.get(dedupKey);
        if (last && this.isSameAction(last, repair)) {
          // Consecutive identical non-repair action for the same still-blocked
          // capability — update timestamp on the existing entry instead of
          // appending a duplicate.
          last.timestamp = repair.timestamp;
        } else {
          this.repairHistory.push(repair);
          this.lastRecordedByKey.set(dedupKey, repair);
        }
      }
    }

    // Enforce rolling window cap
    if (this.repairHistory.length > this.maxHistoryEntries) {
      const excess = this.repairHistory.length - this.maxHistoryEntries;
      this.repairHistory.splice(0, excess);
    }

    return result;
  }

  /**
   * Build a dedup key for a repair action. Two actions with the same key
   * represent the same response to the same blocker on the same capability.
   */
  private dedupKey(repair: RepairAction): string {
    return `${repair.capabilityId}::${repair.plannedAction}`;
  }

  /**
   * Check if a repair action is a non-repair action (workaround, escalation,
   * or refusal) rather than an actual repair where a handler was invoked.
   * Non-repair actions are eligible for dedup; actual repairs are always
   * recorded because they represent real attempted work.
   */
  private isNonRepairAction(repair: RepairAction): boolean {
    return repair.plannedAction.startsWith('WORK_AROUND') ||
           repair.plannedAction.startsWith('ESCALATE') ||
           repair.plannedAction.startsWith('FLAPPING') ||
           repair.plannedAction === 'REFUSE';
  }

  /**
   * Check if two repair actions are semantically identical (same capability,
   * same planned action, same classification). Used to dedup consecutive
   * non-repair actions for still-blocked capabilities.
   */
  private isSameAction(a: RepairAction, b: RepairAction): boolean {
    return a.capabilityId === b.capabilityId &&
           a.plannedAction === b.plannedAction &&
           a.classification === b.classification;
  }

  // ─── Flapping guardrail helpers ──────────────────────────────────

  /**
   * Record a successful repair for a capability and check if it has
   * exceeded the flapping threshold. If so, flag the capability as
   * flapping so future cycles escalate instead of retrying.
   *
   * A "flapping" capability is one that has been repaired
   * >= flappingThreshold times within the last flappingWindowCycles
   * cycles. The fact that it needed repairing again means the previous
   * repair didn't stick — likely because another capability's repair
   * perturbed it, or the root cause wasn't actually fixed.
   */
  private recordRepairForFlapping(capabilityId: string): void {
    if (this.flappingThreshold === Infinity) {
      return; // Guardrail disabled
    }

    let cycles = this.repairCyclesByCapability.get(capabilityId);
    if (!cycles) {
      cycles = [];
      this.repairCyclesByCapability.set(capabilityId, cycles);
    }
    cycles.push(this.cycleCount);

    // Prune entries outside the rolling window
    const windowStart = this.cycleCount - this.flappingWindowCycles;
    while (cycles.length > 0 && cycles[0] < windowStart) {
      cycles.shift();
    }

    // Check threshold
    if (cycles.length >= this.flappingThreshold) {
      this.flappingCapabilities.add(capabilityId);
    }
  }

  /**
   * Clear the flapping flag for a capability. Call this after a manual
   * intervention or after the capability has stayed READY for
   * flappingWindowCycles cycles.
   */
  clearFlappingFlag(capabilityId: string): void {
    this.flappingCapabilities.delete(capabilityId);
    this.repairCyclesByCapability.delete(capabilityId);
  }

  /**
   * Get the set of capabilities currently flagged as flapping.
   */
  getFlappingCapabilities(): Set<string> {
    return new Set(this.flappingCapabilities);
  }

  /**
   * Create a repair action that records a flapping escalation — the
   * capability was repaired too many times without sticking, so the
   * engine is escalating instead of retrying.
   */
  private createFlappingRepair(report: CapabilityHealthReport): RepairAction {
    return {
      repairId: `repair_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      capabilityId: report.capabilityId,
      problem: report.evidence,
      evidence: report.evidence,
      classification: report.failureClassification,
      riskLevel: 'R2',
      plannedAction: `FLAPPING: Capability repaired >= ${this.flappingThreshold} times in ${this.flappingWindowCycles} cycles without converging — escalating to human`,
      authorized: false,
      authorizedBy: null,
      executed: false,
      verified: false,
      verificationEvidence: null,
      timestamp: new Date().toISOString(),
      rollbackInfo: null,
    };
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

      // VERIFY — two layers:
      // 1. Handler's own success flag (necessary but not sufficient)
      // 2. Independent post-repair health check (if verifyRepairFn is wired)
      let verified = result.success;
      let verificationEvidence = result.evidence;

      if (verified && this.verifyRepairFn) {
        // Independent verification — don't trust the handler alone
        try {
          const postCheck = await this.verifyRepairFn(report.capabilityId);
          if (!postCheck.healthy) {
            verified = false;
            verificationEvidence = `Handler reported success but independent verification failed: ${postCheck.evidence}`;
          } else {
            verificationEvidence = `${result.evidence} — independently verified: ${postCheck.evidence}`;
          }
        } catch (verifyError) {
          // Verification function threw — be conservative and mark unverified
          verified = false;
          verificationEvidence = `Handler reported success but verification threw: ${verifyError instanceof Error ? verifyError.message : 'unknown'}`;
        }
      }

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
        verificationEvidence,
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
 *
 * The handler clears stale state by removing the stale runtime artifact
 * and then verifies the artifact no longer exists. If the artifact cannot
 * be removed or still exists after removal, the repair is reported as
 * failed — never as a fabricated success.
 */
export function createStaleStateRepairHandler(options: {
  statePath: string;
}): (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }> {
  return async (capabilityId: string, _procedure: string) => {
    const { existsSync, unlinkSync } = await import('fs');
    const { resolve } = await import('path');
    const fullPath = resolve(options.statePath);

    try {
      // Precondition: the stale state artifact must exist
      if (!existsSync(fullPath)) {
        return {
          success: true,
          evidence: `Stale state artifact already absent for ${capabilityId} at ${fullPath}`,
        };
      }

      // Execute: remove the stale artifact
      unlinkSync(fullPath);

      // Verify: confirm the artifact no longer exists
      if (existsSync(fullPath)) {
        return {
          success: false,
          evidence: `Stale state artifact still present after removal for ${capabilityId} at ${fullPath}`,
        };
      }

      return {
        success: true,
        evidence: `Stale state artifact removed and verified absent for ${capabilityId} at ${fullPath}`,
      };
    } catch (error) {
      return {
        success: false,
        evidence: `Stale state repair failed for ${capabilityId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  };
}

/**
 * Create a repair handler for Ollama (local model) service restart.
 * This is R0 — safe, reversible, local.
 *
 * The handler attempts to start Ollama via `ollama serve` and then
 * verifies the service is responding at the configured URL. If Ollama
 * is already running and healthy, the handler returns success without
 * restarting (idempotent).
 */
export function createOllamaRepairHandler(options: {
  url: string;
  model?: string;
}): (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }> {
  return async (capabilityId: string, _procedure: string) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Precondition: check if Ollama is already healthy
      try {
        const response = await fetch(options.url, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          return {
            success: true,
            evidence: `Ollama already healthy at ${options.url} (HTTP ${response.status}) — no restart needed`,
          };
        }
      } catch {
        // Ollama not responding — proceed with restart
      }

      // Execute: start Ollama
      try {
        // On Windows, use `start /B` to run in background; on Unix, use nohup
        const isWindows = process.platform === 'win32';
        if (isWindows) {
          await execAsync('start /B ollama serve', { timeout: 5000 });
        } else {
          await execAsync('nohup ollama serve > /dev/null 2>&1 &', { timeout: 5000 });
        }
      } catch (startError) {
        // `ollama serve` might fail if already running or not installed
        // Don't fail yet — verification will determine the real state
      }

      // Wait for Ollama to come up (up to 15 seconds)
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const response = await fetch(options.url, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            return {
              success: true,
              evidence: `Ollama restarted and verified healthy at ${options.url} (HTTP ${response.status})`,
            };
          }
        } catch {
          // Still waiting
        }
      }

      // Verify: Ollama did not come up
      return {
        success: false,
        evidence: `Ollama restart failed — service not responding at ${options.url} after 15s`,
      };
    } catch (error) {
      return {
        success: false,
        evidence: `Ollama repair failed for ${capabilityId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  };
}
