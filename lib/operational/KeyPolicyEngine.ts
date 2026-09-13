/**
 * Key Policy Engine
 *
 * Integrates key operations with the existing HYDI governance architecture.
 *
 * Every destructive or high-risk key operation must pass through this engine
 * before execution. The engine evaluates:
 *   - Risk level (LOW, MEDIUM, HIGH, CRITICAL)
 *   - Authorization mode (autonomous, policy_authorized, owner_authorized, denied)
 *   - Policy conditions (environment, key state, operation type)
 *
 * This builds on the existing AutonomyPolicyModel (R0/R1/R2/R3/R5) and
 * the existing PolicyDecisionRecordStore for durable audit.
 *
 * Risk classification:
 *   LOW:      inventory, metadata inspection, expiration analysis
 *   MEDIUM:   generate development credential, rotate low-risk credential
 *   HIGH:     production rotation, production revocation, privilege changes
 *   CRITICAL: root/admin credential creation, mass revocation, master-key ops
 */

import type {
  KeyMetadata,
  KeyRiskLevel,
  KeyAuditOperation,
} from './KeyManagementTypes';
import type {
  AuthorizationLevel,
  PolicyDecision,
} from './CapabilityAcquisitionTypes';

// ─── Policy Types ────────────────────────────────────────────────────────

/**
 * The result of a policy evaluation for a key operation.
 */
export interface KeyPolicyEvaluationResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Policy decision */
  decision: PolicyDecision;
  /** Required authorization level */
  requiredAuthorization: AuthorizationLevel;
  /** Risk level */
  riskLevel: KeyRiskLevel;
  /** Reason for the decision */
  reason: string;
  /** Policy ID that was applied */
  policyId: string;
  /** Conditions that were checked */
  conditions: string[];
  /** Whether this requires human approval */
  requiresHumanApproval: boolean;
}

/**
 * Context for a key policy evaluation.
 */
export interface KeyPolicyContext {
  /** The operation being requested */
  operation: KeyAuditOperation;
  /** The key metadata (if the operation targets an existing key) */
  keyMetadata: KeyMetadata | null;
  /** The provider ID */
  providerId: string;
  /** The environment (development, staging, production) */
  environment: string;
  /** Whether this is a dry-run */
  dryRun: boolean;
  /** Whether the kill switch is active */
  killSwitchActive: boolean;
  /** Whether autonomous mode is enabled */
  autonomousModeEnabled: boolean;
}

// ─── Key Policy Rules ────────────────────────────────────────────────────

/**
 * A key policy rule.
 */
interface KeyPolicyRule {
  id: string;
  operation: KeyAuditOperation;
  riskLevel: KeyRiskLevel;
  requiredAuthorization: AuthorizationLevel;
  decision: PolicyDecision;
  conditions: Array<(ctx: KeyPolicyContext) => boolean>;
  conditionDescriptions: string[];
  reason: string;
}

/**
 * Default key policy rules.
 *
 * These map to the existing R0/R1/R2/R3/R5 authorization model:
 *   R0 = observation (autonomous) — inventory, metadata, health checks
 *   R1 = reversible local action (autonomous) — dev credential generation
 *   R2 = external side effect (policy_authorized) — rotation, provisioning
 *   R3 = financial/legal/identity commitment (owner_authorized) — production creation, revocation
 *   R5 = never authorized (guardian block) — mass revocation, master-key ops
 */
const KEY_POLICY_RULES: KeyPolicyRule[] = [
  // ─── LOW risk: observation (R0, autonomous) ───────────────────────────
  // Observation rules have NO kill switch condition — they are always allowed
  // because they are read-only. The kill switch check in evaluate() already
  // blocks non-observation operations.
  {
    id: 'key.policy.discover',
    operation: 'DISCOVER',
    riskLevel: 'LOW',
    requiredAuthorization: 'R0',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Discovery is read-only and autonomous',
  },
  {
    id: 'key.policy.classify',
    operation: 'CLASSIFY',
    riskLevel: 'LOW',
    requiredAuthorization: 'R0',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Classification is read-only and autonomous',
  },
  {
    id: 'key.policy.scan',
    operation: 'SCAN',
    riskLevel: 'LOW',
    requiredAuthorization: 'R0',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Secret scanning is read-only and autonomous',
  },
  {
    id: 'key.policy.health_check',
    operation: 'HEALTH_CHECK',
    riskLevel: 'LOW',
    requiredAuthorization: 'R0',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Health checks are read-only and autonomous',
  },
  {
    id: 'key.policy.validate',
    operation: 'VALIDATE',
    riskLevel: 'LOW',
    requiredAuthorization: 'R0',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Validation is read-only and autonomous',
  },
  {
    id: 'key.policy.reconcile',
    operation: 'RECONCILE',
    riskLevel: 'LOW',
    requiredAuthorization: 'R0',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Inventory reconciliation is read-only and autonomous',
  },

  // ─── MEDIUM risk: development credential operations (R1, autonomous) ──
  {
    id: 'key.policy.generate_dev',
    operation: 'GENERATE',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'development' || ctx.environment === 'test',
      (ctx) => ctx.dryRun || true, // Allow both dry-run and real in dev
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is development or test'],
    reason: 'Development credential generation is autonomous in dev/test environments',
  },
  {
    id: 'key.policy.store',
    operation: 'STORE',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled'],
    reason: 'Storing credentials in vault is autonomous (local action)',
  },
  {
    id: 'key.policy.provision_dev',
    operation: 'PROVISION',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'development' || ctx.environment === 'test',
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is development or test'],
    reason: 'Provisioning to dev/test environment is autonomous',
  },
  {
    id: 'key.policy.rotate_low_risk',
    operation: 'ROTATE',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'development' || ctx.environment === 'test',
      (ctx) => ctx.keyMetadata?.riskLevel === 'LOW' || ctx.keyMetadata?.riskLevel === 'MEDIUM',
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is dev/test', 'key risk is LOW or MEDIUM'],
    reason: 'Low-risk credential rotation in dev/test is autonomous',
  },

  // ─── HIGH risk: production operations (R2/R3, policy or owner authorized) ─
  {
    id: 'key.policy.generate_prod',
    operation: 'GENERATE',
    riskLevel: 'HIGH',
    requiredAuthorization: 'R3',
    decision: 'REQUIRES_OWNER_AUTHORIZATION',
    conditions: [
      (ctx) => ctx.environment === 'production',
    ],
    conditionDescriptions: ['environment is production'],
    reason: 'Production credential generation requires owner authorization',
  },
  {
    id: 'key.policy.provision_prod',
    operation: 'PROVISION',
    riskLevel: 'HIGH',
    requiredAuthorization: 'R2',
    decision: 'ALLOW_WITH_POLICY',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'production',
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is production'],
    reason: 'Production provisioning requires policy authorization',
  },
  {
    id: 'key.policy.rotate_prod',
    operation: 'ROTATE',
    riskLevel: 'HIGH',
    requiredAuthorization: 'R2',
    decision: 'ALLOW_WITH_POLICY',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'production',
      (ctx) => ctx.keyMetadata?.riskLevel === 'HIGH' || ctx.keyMetadata?.riskLevel === 'MEDIUM',
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is production', 'key risk is HIGH or MEDIUM'],
    reason: 'Production rotation requires policy authorization',
  },
  {
    id: 'key.policy.revoke_dev',
    operation: 'REVOKE',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'development' || ctx.environment === 'test',
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is development or test'],
    reason: 'Dev/test revocation is autonomous',
  },
  {
    id: 'key.policy.revoke_prod',
    operation: 'REVOKE',
    riskLevel: 'HIGH',
    requiredAuthorization: 'R3',
    decision: 'REQUIRES_OWNER_AUTHORIZATION',
    conditions: [
      (ctx) => ctx.environment === 'production',
    ],
    conditionDescriptions: ['environment is production'],
    reason: 'Production revocation requires owner authorization',
  },

  // ─── CRITICAL risk: master key operations (R3/R5) ─────────────────────
  {
    id: 'key.policy.rotate_critical',
    operation: 'ROTATE',
    riskLevel: 'CRITICAL',
    requiredAuthorization: 'R3',
    decision: 'REQUIRES_OWNER_AUTHORIZATION',
    conditions: [
      (ctx) => ctx.keyMetadata?.riskLevel === 'CRITICAL',
    ],
    conditionDescriptions: ['key risk is CRITICAL'],
    reason: 'Critical risk key rotation requires owner authorization',
  },
  {
    id: 'key.policy.destroy',
    operation: 'DESTROY',
    riskLevel: 'CRITICAL',
    requiredAuthorization: 'R3',
    decision: 'REQUIRES_OWNER_AUTHORIZATION',
    conditions: [],
    conditionDescriptions: [],
    reason: 'Key destruction is always owner-authorized',
  },
  {
    id: 'key.policy.destroy_dev',
    operation: 'DESTROY',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
      (ctx) => ctx.environment === 'development' || ctx.environment === 'test',
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled', 'environment is development or test'],
    reason: 'Dev/test key destruction is autonomous',
  },

  // ─── Compromise response (R2, policy authorized) ──────────────────────
  {
    id: 'key.policy.compromise_response',
    operation: 'COMPROMISE_RESPONSE',
    riskLevel: 'HIGH',
    requiredAuthorization: 'R2',
    decision: 'ALLOW_WITH_POLICY',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled'],
    reason: 'Compromise response (isolate + replace) is policy-authorized for safety',
  },

  // ─── Recovery (R1, autonomous) ────────────────────────────────────────
  {
    id: 'key.policy.recover',
    operation: 'RECOVER',
    riskLevel: 'MEDIUM',
    requiredAuthorization: 'R1',
    decision: 'ALLOW_AUTONOMOUS',
    conditions: [
      (ctx) => !ctx.killSwitchActive,
      (ctx) => ctx.autonomousModeEnabled,
    ],
    conditionDescriptions: ['kill switch not active', 'autonomous mode enabled'],
    reason: 'Credential recovery is autonomous (local action)',
  },
];

// ─── Key Policy Engine ───────────────────────────────────────────────────

/**
 * Evaluates key operations against policy rules.
 *
 * This is the governance gate for all key lifecycle operations.
 * No key operation may proceed without passing through this engine.
 */
export class KeyPolicyEngine {
  private rules: KeyPolicyRule[];

  constructor(customRules?: KeyPolicyRule[]) {
    this.rules = customRules ?? KEY_POLICY_RULES;
  }

  /**
   * Evaluate a key operation against policy.
   *
   * @returns The policy evaluation result
   */
  evaluate(ctx: KeyPolicyContext): KeyPolicyEvaluationResult {
    // Kill switch blocks everything except observation
    if (ctx.killSwitchActive) {
      const isObservation = ['DISCOVER', 'CLASSIFY', 'SCAN', 'HEALTH_CHECK', 'VALIDATE', 'RECONCILE'].includes(ctx.operation);
      if (!isObservation) {
        return {
          allowed: false,
          decision: 'DENY',
          requiredAuthorization: 'R5',
          riskLevel: this.classifyRisk(ctx),
          reason: 'Kill switch is active — all key mutations blocked',
          policyId: 'key.policy.kill_switch',
          conditions: ['kill switch active'],
          requiresHumanApproval: true,
        };
      }
    }

    // Find matching rule
    const matchingRules = this.rules.filter(r => r.operation === ctx.operation);

    if (matchingRules.length === 0) {
      // No rule found — fail closed
      return {
        allowed: false,
        decision: 'DENY',
        requiredAuthorization: 'R5',
        riskLevel: this.classifyRisk(ctx),
        reason: `No policy rule found for operation ${ctx.operation} — failing closed`,
        policyId: 'key.policy.default_deny',
        conditions: [],
        requiresHumanApproval: true,
      };
    }

    // Find the first rule whose conditions are all met
    for (const rule of matchingRules) {
      const allConditionsMet = rule.conditions.every(c => c(ctx));

      if (allConditionsMet) {
        const requiresHumanApproval =
          rule.decision === 'REQUIRES_OWNER_AUTHORIZATION' || rule.requiredAuthorization === 'R3';

        return {
          allowed: rule.decision !== 'DENY' && rule.decision !== 'REQUIRES_OWNER_AUTHORIZATION',
          decision: rule.decision,
          requiredAuthorization: rule.requiredAuthorization,
          riskLevel: rule.riskLevel,
          reason: rule.reason,
          policyId: rule.id,
          conditions: rule.conditionDescriptions,
          requiresHumanApproval,
        };
      }
    }

    // No rule's conditions were met — fail closed
    const fallbackRule = matchingRules[0];
    return {
      allowed: false,
      decision: 'DENY',
      requiredAuthorization: fallbackRule.requiredAuthorization,
      riskLevel: fallbackRule.riskLevel,
      reason: `Conditions not met for ${ctx.operation} — failing closed`,
      policyId: `${fallbackRule.id}.conditions_not_met`,
      conditions: fallbackRule.conditionDescriptions,
      requiresHumanApproval: true,
    };
  }

  /**
   * Classify the risk level for an operation context.
   */
  classifyRisk(ctx: KeyPolicyContext): KeyRiskLevel {
    // Base risk on operation type
    const operationRisk: Record<KeyAuditOperation, KeyRiskLevel> = {
      DISCOVER: 'LOW',
      CLASSIFY: 'LOW',
      SCAN: 'LOW',
      HEALTH_CHECK: 'LOW',
      VALIDATE: 'LOW',
      RECONCILE: 'LOW',
      GENERATE: ctx.environment === 'production' ? 'HIGH' : 'MEDIUM',
      STORE: 'MEDIUM',
      PROVISION: ctx.environment === 'production' ? 'HIGH' : 'MEDIUM',
      ROTATE: ctx.keyMetadata?.riskLevel === 'CRITICAL' ? 'CRITICAL'
        : ctx.environment === 'production' ? 'HIGH' : 'MEDIUM',
      REVOKE: ctx.environment === 'production' ? 'HIGH' : 'MEDIUM',
      RECOVER: 'MEDIUM',
      DESTROY: 'CRITICAL',
      COMPROMISE_RESPONSE: 'HIGH',
    };

    return operationRisk[ctx.operation] ?? 'MEDIUM';
  }

  /**
   * Get all policy rules (for inspection/debugging).
   */
  getRules(): readonly KeyPolicyRule[] {
    return this.rules;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let policyEngineInstance: KeyPolicyEngine | null = null;

export function getKeyPolicyEngine(): KeyPolicyEngine {
  if (!policyEngineInstance) {
    policyEngineInstance = new KeyPolicyEngine();
  }
  return policyEngineInstance;
}

export function resetKeyPolicyEngine(): void {
  policyEngineInstance = null;
}
