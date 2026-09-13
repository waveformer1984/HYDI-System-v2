/**
 * HEIDI Communication Policy Model
 *
 * Integrates communication actions into the existing HYDI autonomy framework.
 * Every outbound communication action must pass through this policy model
 * before execution. The policy is deterministic — the LLM may propose
 * messages, but the policy engine decides what is actually permitted.
 *
 * Principles (inherited from the operational autonomy framework):
 *   - identity ≠ permission ≠ policy ≠ execution
 *   - confidence ≠ authorization
 *   - the safest autonomous action is frequently doing nothing
 *   - autonomy must be governed
 *
 * Risk classification for communication actions:
 *   R0 — autonomous, no external impact (acknowledge, FAQ, status)
 *   R1 — autonomous within compliance (prospect outreach, reminders)
 *   R2 — policy-authorized within limits (sales follow-up, support, onboarding)
 *   R3 — human required (contractual, price changes, refunds)
 *   R4 — human required, high impact (escalation, security)
 *   R5 — prohibited autonomously (unrestricted communication)
 */

import type {
  CommunicationActionType,
  CommunicationRiskLevel,
  AuthorizationMode,
  AuthorizationContext,
  OutboundMessageRequest,
} from './types';

interface CommunicationPolicy {
  actionType: CommunicationActionType;
  risk: CommunicationRiskLevel;
  authorization: AuthorizationMode;
  maxPerRecipientPerHour: number;
  maxPerConversationPerHour: number;
  cooldownMs: number;
  requiresConsent: boolean;
  requiresExistingRelationship: boolean;
  description: string;
}

const COMMUNICATION_POLICIES: Record<CommunicationActionType, CommunicationPolicy> = {
  // R0 — autonomous, no external impact
  acknowledge: {
    actionType: 'acknowledge',
    risk: 'R0',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 60,
    maxPerConversationPerHour: 30,
    cooldownMs: 0,
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Acknowledge receipt of a message — no external impact',
  },
  answer_faq: {
    actionType: 'answer_faq',
    risk: 'R0',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 30,
    maxPerConversationPerHour: 20,
    cooldownMs: 1000,
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Answer frequently asked questions — informational only',
  },
  provide_status: {
    actionType: 'provide_status',
    risk: 'R0',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 20,
    maxPerConversationPerHour: 10,
    cooldownMs: 5000,
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Provide order/task status — requires existing relationship',
  },
  system_notification: {
    actionType: 'system_notification',
    risk: 'R0',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 100,
    maxPerConversationPerHour: 50,
    cooldownMs: 0,
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Internal system notification — no external recipient',
  },

  // R1 — autonomous within compliance
  prospect_outreach: {
    actionType: 'prospect_outreach',
    risk: 'R1',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 2,
    maxPerConversationPerHour: 2,
    cooldownMs: 3600000, // 1 hour
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Initial prospect outreach — bounded, compliant cold contact',
  },
  prospect_follow_up: {
    actionType: 'prospect_follow_up',
    risk: 'R1',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 2,
    maxPerConversationPerHour: 3,
    cooldownMs: 1800000, // 30 minutes
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Follow up with an existing prospect — bounded frequency',
  },
  appointment_reminder: {
    actionType: 'appointment_reminder',
    risk: 'R1',
    authorization: 'autonomous',
    maxPerRecipientPerHour: 5,
    maxPerConversationPerHour: 5,
    cooldownMs: 600000, // 10 minutes
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Send appointment reminders — requires existing relationship',
  },

  // R2 — policy-authorized within limits
  sales_follow_up: {
    actionType: 'sales_follow_up',
    risk: 'R2',
    authorization: 'policy_authorized',
    maxPerRecipientPerHour: 3,
    maxPerConversationPerHour: 5,
    cooldownMs: 1800000,
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Sales follow-up — policy-authorized, bounded',
  },
  proposal_follow_up: {
    actionType: 'proposal_follow_up',
    risk: 'R2',
    authorization: 'policy_authorized',
    maxPerRecipientPerHour: 2,
    maxPerConversationPerHour: 3,
    cooldownMs: 3600000,
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Follow up on a sent proposal — policy-authorized',
  },
  customer_onboarding: {
    actionType: 'customer_onboarding',
    risk: 'R2',
    authorization: 'policy_authorized',
    maxPerRecipientPerHour: 5,
    maxPerConversationPerHour: 10,
    cooldownMs: 600000,
    requiresConsent: true,
    requiresExistingRelationship: true,
    description: 'Customer onboarding communication — requires consent',
  },
  support_response: {
    actionType: 'support_response',
    risk: 'R2',
    authorization: 'policy_authorized',
    maxPerRecipientPerHour: 20,
    maxPerConversationPerHour: 30,
    cooldownMs: 1000,
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Respond to support requests — policy-authorized',
  },
  retention_message: {
    actionType: 'retention_message',
    risk: 'R2',
    authorization: 'policy_authorized',
    maxPerRecipientPerHour: 1,
    maxPerConversationPerHour: 2,
    cooldownMs: 7200000, // 2 hours
    requiresConsent: true,
    requiresExistingRelationship: true,
    description: 'Retention messaging — requires consent, low frequency',
  },
  operational_alert: {
    actionType: 'operational_alert',
    risk: 'R2',
    authorization: 'policy_authorized',
    maxPerRecipientPerHour: 30,
    maxPerConversationPerHour: 30,
    cooldownMs: 60000,
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Operational alert to stakeholders — policy-authorized',
  },

  // R3 — human required
  contractual_commitment: {
    actionType: 'contractual_commitment',
    risk: 'R3',
    authorization: 'human_required',
    maxPerRecipientPerHour: 0,
    maxPerConversationPerHour: 0,
    cooldownMs: 0,
    requiresConsent: true,
    requiresExistingRelationship: true,
    description: 'Contractual commitments — human authorization required',
  },
  price_change: {
    actionType: 'price_change',
    risk: 'R3',
    authorization: 'human_required',
    maxPerRecipientPerHour: 0,
    maxPerConversationPerHour: 0,
    cooldownMs: 0,
    requiresConsent: true,
    requiresExistingRelationship: true,
    description: 'Price change communication — human authorization required',
  },
  refund_communication: {
    actionType: 'refund_communication',
    risk: 'R3',
    authorization: 'human_required',
    maxPerRecipientPerHour: 0,
    maxPerConversationPerHour: 0,
    cooldownMs: 0,
    requiresConsent: false,
    requiresExistingRelationship: true,
    description: 'Refund-related communication — human authorization required',
  },
  legal_communication: {
    actionType: 'legal_communication',
    risk: 'R3',
    authorization: 'human_required',
    maxPerRecipientPerHour: 0,
    maxPerConversationPerHour: 0,
    cooldownMs: 0,
    requiresConsent: true,
    requiresExistingRelationship: true,
    description: 'Legal communication — human authorization required',
  },

  // R4 — human required, high impact
  escalation: {
    actionType: 'escalation',
    risk: 'R4',
    authorization: 'human_required',
    maxPerRecipientPerHour: 10,
    maxPerConversationPerHour: 10,
    cooldownMs: 60000,
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Escalation to human operator — always allowed but human-authorized',
  },
  security_action: {
    actionType: 'security_action',
    risk: 'R4',
    authorization: 'human_required',
    maxPerRecipientPerHour: 0,
    maxPerConversationPerHour: 0,
    cooldownMs: 0,
    requiresConsent: false,
    requiresExistingRelationship: false,
    description: 'Security-related communication — human authorization required',
  },

  // R5 — prohibited autonomously
  unrestricted_communication: {
    actionType: 'unrestricted_communication',
    risk: 'R5',
    authorization: 'prohibited',
    maxPerRecipientPerHour: 0,
    maxPerConversationPerHour: 0,
    cooldownMs: 0,
    requiresConsent: true,
    requiresExistingRelationship: true,
    description: 'Unrestricted communication — prohibited for autonomous Heidi',
  },
};

export interface PolicyEvaluationResult {
  policy: CommunicationPolicy;
  authorized: boolean;
  reason: string;
  riskLevel: CommunicationRiskLevel;
  authorizationMode: AuthorizationMode;
}

export class CommunicationPolicyModel {
  private policies: Record<CommunicationActionType, CommunicationPolicy>;
  private overrides: Map<CommunicationActionType, Partial<CommunicationPolicy>> = new Map();

  constructor() {
    this.policies = { ...COMMUNICATION_POLICIES };
  }

  getPolicy(actionType: CommunicationActionType): CommunicationPolicy | null {
    const base = this.policies[actionType];
    if (!base) return null;
    const override = this.overrides.get(actionType);
    return override ? { ...base, ...override } : base;
  }

  getAllPolicies(): CommunicationPolicy[] {
    return Object.values(this.policies);
  }

  evaluate(
    actionType: CommunicationActionType,
    context: {
      actor: string;
      recipientId: string;
      conversationId: string;
      hasExistingRelationship: boolean;
      hasConsent: boolean;
      isAutonomous: boolean;
    },
  ): PolicyEvaluationResult {
    const policy = this.getPolicy(actionType);
    if (!policy) {
      return {
        policy: COMMUNICATION_POLICIES.unrestricted_communication,
        authorized: false,
        reason: `unknown action type: ${actionType} — denied by default`,
        riskLevel: 'R5',
        authorizationMode: 'prohibited',
      };
    }

    // R5 — always prohibited for autonomous
    if (policy.risk === 'R5' && context.isAutonomous) {
      return {
        policy,
        authorized: false,
        reason: `risk R5 is prohibited for autonomous Heidi`,
        riskLevel: policy.risk,
        authorizationMode: 'prohibited',
      };
    }

    // R3/R4 — human required
    if ((policy.risk === 'R3' || policy.risk === 'R4') && context.isAutonomous) {
      return {
        policy,
        authorized: false,
        reason: `risk ${policy.risk} requires human authorization for ${actionType}`,
        riskLevel: policy.risk,
        authorizationMode: 'human_required',
      };
    }

    // Consent check
    if (policy.requiresConsent && !context.hasConsent) {
      return {
        policy,
        authorized: false,
        reason: `${actionType} requires recipient consent — not granted`,
        riskLevel: policy.risk,
        authorizationMode: policy.authorization,
      };
    }

    // Relationship check
    if (policy.requiresExistingRelationship && !context.hasExistingRelationship) {
      return {
        policy,
        authorized: false,
        reason: `${actionType} requires an existing relationship with the recipient`,
        riskLevel: policy.risk,
        authorizationMode: policy.authorization,
      };
    }

    // Rate limit check (zero means prohibited)
    if (policy.maxPerRecipientPerHour === 0 && context.isAutonomous) {
      return {
        policy,
        authorized: false,
        reason: `${actionType} has zero autonomous rate limit — human authorization required`,
        riskLevel: policy.risk,
        authorizationMode: 'human_required',
      };
    }

    return {
      policy,
      authorized: true,
      reason: `authorized: ${policy.description}`,
      riskLevel: policy.risk,
      authorizationMode: policy.authorization,
    };
  }

  buildAuthorizationContext(
    actionType: CommunicationActionType,
    actor: string,
    evaluation: PolicyEvaluationResult,
  ): AuthorizationContext {
    return {
      actor,
      actionType,
      riskLevel: evaluation.riskLevel,
      authorizationMode: evaluation.authorizationMode,
      authorized: evaluation.authorized,
      reason: evaluation.reason,
      policyReference: evaluation.policy.actionType,
      timestamp: new Date().toISOString(),
    };
  }

  isAutonomouslyExecutable(actionType: CommunicationActionType): boolean {
    const policy = this.getPolicy(actionType);
    if (!policy) return false;
    return policy.authorization === 'autonomous';
  }

  requiresHuman(actionType: CommunicationActionType): boolean {
    const policy = this.getPolicy(actionType);
    if (!policy) return true;
    return policy.authorization === 'human_required';
  }

  isProhibited(actionType: CommunicationActionType): boolean {
    const policy = this.getPolicy(actionType);
    if (!policy) return true;
    return policy.authorization === 'prohibited';
  }

  getRateLimits(actionType: CommunicationActionType): {
    maxPerRecipientPerHour: number;
    maxPerConversationPerHour: number;
    cooldownMs: number;
  } {
    const policy = this.getPolicy(actionType);
    if (!policy) {
      return { maxPerRecipientPerHour: 0, maxPerConversationPerHour: 0, cooldownMs: 0 };
    }
    return {
      maxPerRecipientPerHour: policy.maxPerRecipientPerHour,
      maxPerConversationPerHour: policy.maxPerConversationPerHour,
      cooldownMs: policy.cooldownMs,
    };
  }
}

export const communicationPolicyModel = new CommunicationPolicyModel();
