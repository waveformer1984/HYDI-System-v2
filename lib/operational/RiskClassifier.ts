/**
 * HYDI Risk Classification
 *
 * Phase 4 — Classifies autonomous actions by risk level.
 *
 * Risk levels:
 *   R0 = read-only (health checks, diagnostics, probes)
 *   R1 = reversible process recovery (restart a boot module)
 *   R2 = bounded configuration/runtime change
 *   R3 = persistent state modification (database writes, config changes)
 *   R4 = security-sensitive action (credential changes, auth modifications)
 *   R5 = destructive/external action (data deletion, payments, git push)
 *
 * Default authorization policy:
 *   R0 → autonomous
 *   R1 → autonomous within bounds
 *   R2 → explicit policy authorization
 *   R3 → human authorization
 *   R4 → human authorization
 *   R5 → prohibited by autonomous Heidi
 *
 * The principle: confidence ≠ authorization.
 * A high-confidence diagnosis does not authorize a high-risk action.
 */

import type { RiskLevel, AuthorizationMode, Capability } from './types';

/**
 * Default risk level per capability.
 */
const CAPABILITY_RISK: Record<Capability, RiskLevel> = {
  'health.read': 'R0',
  'health.recover': 'R1',
  'process.restart': 'R1',
  'process.kill': 'R1',
  'database.recover': 'R2',
  'configuration.validate': 'R0',
  'runtime.probe': 'R0',
  'diagnostic.snapshot': 'R0',
};

/**
 * Default authorization mode per risk level.
 */
const RISK_AUTHORIZATION: Record<RiskLevel, AuthorizationMode> = {
  R0: 'autonomous',
  R1: 'autonomous',
  R2: 'policy_authorized',
  R3: 'human_required',
  R4: 'human_required',
  R5: 'prohibited',
};

/**
 * Human-readable risk descriptions.
 */
const RISK_DESCRIPTIONS: Record<RiskLevel, string> = {
  R0: 'read-only — no side effects',
  R1: 'reversible process recovery — bounded restart',
  R2: 'bounded configuration/runtime change — requires policy authorization',
  R3: 'persistent state modification — requires human authorization',
  R4: 'security-sensitive action — requires human authorization',
  R5: 'destructive/external action — prohibited for autonomous Heidi',
};

export class RiskClassifier {
  /**
   * Classify the risk level of a capability.
   */
  classifyCapability(capability: Capability): RiskLevel {
    return CAPABILITY_RISK[capability] ?? 'R5'; // unknown = highest risk
  }

  /**
   * Get the default authorization mode for a risk level.
   */
  getAuthorizationMode(risk: RiskLevel): AuthorizationMode {
    return RISK_AUTHORIZATION[risk];
  }

  /**
   * Check if a risk level is autonomously executable.
   */
  isAutonomous(risk: RiskLevel): boolean {
    const mode = RISK_AUTHORIZATION[risk];
    return mode === 'autonomous';
  }

  /**
   * Check if a risk level requires human authorization.
   */
  requiresHuman(risk: RiskLevel): boolean {
    const mode = RISK_AUTHORIZATION[risk];
    return mode === 'human_required';
  }

  /**
   * Check if a risk level is prohibited for autonomous Heidi.
   */
  isProhibited(risk: RiskLevel): boolean {
    const mode = RISK_AUTHORIZATION[risk];
    return mode === 'prohibited';
  }

  /**
   * Get a human-readable description of a risk level.
   */
  describe(risk: RiskLevel): string {
    return RISK_DESCRIPTIONS[risk];
  }

  /**
   * Classify a capability and return both risk and authorization mode.
   */
  evaluate(capability: Capability): { risk: RiskLevel; authorization: AuthorizationMode; description: string } {
    const risk = this.classifyCapability(capability);
    return {
      risk,
      authorization: this.getAuthorizationMode(risk),
      description: this.describe(risk),
    };
  }

  /**
   * Get all risk levels with their authorization modes (for diagnostics).
   */
  getAllRiskLevels(): Array<{ risk: RiskLevel; authorization: AuthorizationMode; description: string }> {
    return (Object.keys(RISK_AUTHORIZATION) as RiskLevel[]).map((risk) => ({
      risk,
      authorization: RISK_AUTHORIZATION[risk],
      description: RISK_DESCRIPTIONS[risk],
    }));
  }
}

/**
 * Singleton risk classifier instance.
 */
export const riskClassifier = new RiskClassifier();
