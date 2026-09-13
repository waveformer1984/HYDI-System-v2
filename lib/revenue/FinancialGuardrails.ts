/**
 * HYDI Financial Guardrails
 *
 * Configurable financial limits that bound HEIDI's autonomous revenue operations.
 * These limits are NOT hard-coded throughout the application — they are
 * centralized here and configurable by the operator.
 *
 * HEIDI may autonomously perform configured low-risk commercial actions.
 * Actions involving money transfer, large refunds, unusual discounts,
 * or contractual commitments require explicit human authorization.
 */

import type { FinancialGuardrails, RevenueActionType } from './types';

// ---------------------------------------------------------------------------
// Default Guardrails — conservative, safe for autonomous operation
// ---------------------------------------------------------------------------

const DEFAULT_GUARDRAILS: FinancialGuardrails = {
  // HEIDI can apply up to $50 discount autonomously
  maxAutonomousDiscount: 5000,         // $50.00 in cents

  // HEIDI can issue up to $25 refund autonomously (within policy)
  maxAutonomousRefund: 2500,           // $25.00 in cents

  // Max 50 outbound messages per day
  maxDailyOutbound: 50,

  // Max 25 new prospects per day
  maxDailyNewProspects: 25,

  // No autonomous ad spend — requires human
  maxMonthlyAdSpend: 0,                // $0 — no autonomous ad spend

  // Minimum 40% margin on all offers
  minAcceptableMargin: 0.40,

  // Max CAC of $200
  maxCustomerAcquisitionCost: 20000,   // $200.00 in cents

  // Any action involving more than $500 requires human approval
  requiresHumanApprovalAbove: 50000,   // $500.00 in cents

  // Actions HEIDI must NEVER do autonomously
  prohibitedActions: [
    'spending_money',
    'purchasing_advertising',
    'transferring_money',
    'issuing_credits_above_limit',
    'legal_agreements_outside_templates',
    'security_sensitive_changes',
    'deletion_of_customer_data',
    'irreversible_infrastructure_changes',
    'changing_prices_outside_bounds',
  ],
};

// ---------------------------------------------------------------------------
// Action Risk Mapping
// ---------------------------------------------------------------------------

const ACTION_RISK: Record<RevenueActionType, {
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  authorization: 'autonomous' | 'policy_authorized' | 'human_required' | 'prohibited';
}> = {
  prospect_research:     { riskLevel: 'R0', authorization: 'autonomous' },
  prospect_score:        { riskLevel: 'R0', authorization: 'autonomous' },
  prospect_outreach:     { riskLevel: 'R1', authorization: 'autonomous' },
  prospect_follow_up:    { riskLevel: 'R1', authorization: 'autonomous' },
  appointment_schedule:  { riskLevel: 'R1', authorization: 'autonomous' },
  proposal_generate:     { riskLevel: 'R1', authorization: 'autonomous' },
  customer_onboard:      { riskLevel: 'R2', authorization: 'policy_authorized' },
  service_provision:     { riskLevel: 'R2', authorization: 'policy_authorized' },
  service_monitor:       { riskLevel: 'R0', authorization: 'autonomous' },
  renewal_reminder:      { riskLevel: 'R1', authorization: 'autonomous' },
  support_triage:        { riskLevel: 'R1', authorization: 'autonomous' },
  revenue_report:        { riskLevel: 'R0', authorization: 'autonomous' },
  pipeline_optimize:     { riskLevel: 'R0', authorization: 'autonomous' },
  price_change:          { riskLevel: 'R3', authorization: 'human_required' },
  refund_issue:          { riskLevel: 'R3', authorization: 'human_required' },
  discount_offer:        { riskLevel: 'R2', authorization: 'policy_authorized' },
  escalate_human:        { riskLevel: 'R0', authorization: 'autonomous' },
};

// ---------------------------------------------------------------------------
// Guardrail Engine
// ---------------------------------------------------------------------------

export class GuardrailEngine {
  private guardrails: FinancialGuardrails;

  constructor(config?: Partial<FinancialGuardrails>) {
    this.guardrails = { ...DEFAULT_GUARDRAILS, ...config };
  }

  /**
   * Get the current guardrails configuration.
   */
  getGuardrails(): FinancialGuardrails {
    return { ...this.guardrails };
  }

  /**
   * Update guardrails configuration.
   */
  configure(updates: Partial<FinancialGuardrails>): void {
    this.guardrails = { ...this.guardrails, ...updates };
  }

  /**
   * Check if an action is authorized given the current guardrails.
   */
  authorize(
    actionType: RevenueActionType,
    financialImpact: number,
    context?: {
      discountAmount?: number;
      refundAmount?: number;
      isProhibitedAction?: boolean;
    },
  ): {
    authorized: boolean;
    mode: 'autonomous' | 'policy_authorized' | 'human_required' | 'prohibited';
    reason: string;
  } {
    const risk = ACTION_RISK[actionType];
    if (!risk) {
      return {
        authorized: false,
        mode: 'prohibited',
        reason: `Unknown action type: ${actionType}`,
      };
    }

    // Check prohibited actions list
    if (context?.isProhibitedAction) {
      return {
        authorized: false,
        mode: 'prohibited',
        reason: 'Action is in the prohibited actions list',
      };
    }

    // R5 actions are always prohibited for autonomous HEIDI
    if (risk.riskLevel === 'R5') {
      return {
        authorized: false,
        mode: 'prohibited',
        reason: 'R5 actions are prohibited for autonomous operation',
      };
    }

    // R3+ actions always require human
    if (risk.riskLevel === 'R3' || risk.riskLevel === 'R4') {
      return {
        authorized: false,
        mode: 'human_required',
        reason: `Action is ${risk.riskLevel} — requires explicit human authorization`,
      };
    }

    // Check financial limits for R2 actions
    if (risk.riskLevel === 'R2') {
      if (financialImpact > this.guardrails.requiresHumanApprovalAbove) {
        return {
          authorized: false,
          mode: 'human_required',
          reason: `Financial impact ${financialImpact} exceeds human approval threshold ${this.guardrails.requiresHumanApprovalAbove}`,
        };
      }

      // Check discount limit
      if (context?.discountAmount && context.discountAmount > this.guardrails.maxAutonomousDiscount) {
        return {
          authorized: false,
          mode: 'human_required',
          reason: `Discount ${context.discountAmount} exceeds autonomous limit ${this.guardrails.maxAutonomousDiscount}`,
        };
      }

      // Check refund limit
      if (context?.refundAmount && context.refundAmount > this.guardrails.maxAutonomousRefund) {
        return {
          authorized: false,
          mode: 'human_required',
          reason: `Refund ${context.refundAmount} exceeds autonomous limit ${this.guardrails.maxAutonomousRefund}`,
        };
      }
    }

    // R0 and R1 are autonomous
    return {
      authorized: true,
      mode: risk.authorization as 'autonomous' | 'policy_authorized',
      reason: `Action is ${risk.riskLevel} — within autonomous bounds`,
    };
  }

  /**
   * Check if a discount is within autonomous bounds.
   */
  isDiscountAllowed(amount: number): { allowed: boolean; reason: string } {
    if (amount > this.guardrails.maxAutonomousDiscount) {
      return {
        allowed: false,
        reason: `Discount ${amount} exceeds autonomous limit ${this.guardrails.maxAutonomousDiscount}`,
      };
    }
    return { allowed: true, reason: 'Within autonomous discount limit' };
  }

  /**
   * Check if a refund is within autonomous bounds.
   */
  isRefundAllowed(amount: number): { allowed: boolean; reason: string } {
    if (amount > this.guardrails.maxAutonomousRefund) {
      return {
        allowed: false,
        reason: `Refund ${amount} exceeds autonomous limit ${this.guardrails.maxAutonomousRefund}`,
      };
    }
    return { allowed: true, reason: 'Within autonomous refund limit' };
  }

  /**
   * Check if daily outbound limit is exceeded.
   */
  isOutreachWithinLimit(currentCount: number): { allowed: boolean; remaining: number } {
    const remaining = Math.max(0, this.guardrails.maxDailyOutbound - currentCount);
    return {
      allowed: currentCount < this.guardrails.maxDailyOutbound,
      remaining,
    };
  }

  /**
   * Check if daily prospect limit is exceeded.
   */
  isNewProspectWithinLimit(currentCount: number): { allowed: boolean; remaining: number } {
    const remaining = Math.max(0, this.guardrails.maxDailyNewProspects - currentCount);
    return {
      allowed: currentCount < this.guardrails.maxDailyNewProspects,
      remaining,
    };
  }

  /**
   * Check if margin is acceptable.
   */
  isMarginAcceptable(margin: number): { acceptable: boolean; reason: string } {
    if (margin < this.guardrails.minAcceptableMargin) {
      return {
        acceptable: false,
        reason: `Margin ${(margin * 100).toFixed(1)}% is below minimum ${(this.guardrails.minAcceptableMargin * 100).toFixed(1)}%`,
      };
    }
    return { acceptable: true, reason: 'Margin is above minimum threshold' };
  }

  /**
   * Get the risk level for an action type.
   */
  getRiskLevel(actionType: RevenueActionType): 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' {
    return ACTION_RISK[actionType]?.riskLevel ?? 'R5';
  }
}

// Singleton instance
let guardrailInstance: GuardrailEngine | null = null;

export function getGuardrailEngine(): GuardrailEngine {
  if (!guardrailInstance) {
    guardrailInstance = new GuardrailEngine();
  }
  return guardrailInstance;
}
