/**
 * Authorization Package
 *
 * Creates actionable authorization packages for human approval of R2+ actions.
 *
 * At Level 2, HEIDI MUST NOT autonomously send unsolicited outbound commercial messages.
 * When a qualified opportunity reaches the outbound stage, this module creates
 * an authorization package that the human owner can approve or reject.
 *
 * The package contains everything the human needs to make a decision:
 * - prospect, company, source
 * - ICP evidence
 * - opportunity, offer, price, expected value
 * - proposed message
 * - message channel
 * - risk
 * - reason authorization is required
 * - goal ID, cognitive cycle ID
 * - evidence
 *
 * Approve/reject is explicit. Approval is NEVER inferred.
 */

import type { ProspectRecord, OpportunityRecord, CommercialOffer } from './types';
import type { OutreachDraft } from './OutreachDraftGenerator';

export interface AuthorizationPackage {
  packageId: string;
  createdAt: string;

  // Prospect information
  prospectId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  source: string;

  // ICP evidence
  icpScore: number;
  icpFactors: Record<string, number>;
  icpEvidence: string[];

  // Opportunity
  opportunityId: string;
  offerId: string;
  offerName: string;
  priceCents: number;
  expectedValueCents: number;
  expectedMonthlyCents: number;

  // Proposed action
  proposedAction: string;
  proposedMessage: {
    channel: string;
    subject: string;
    body: string;
  };

  // Risk and authorization
  riskLevel: string;
  authorizationMode: string;
  reasonAuthorizationRequired: string;

  // Provenance
  goalId: string;
  cognitiveCycleId: string;
  evidence: string[];

  // Decision state
  decision: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
}

export interface AuthorizationPackageInput {
  prospect: ProspectRecord;
  opportunity: OpportunityRecord;
  offer: CommercialOffer;
  draft: OutreachDraft;
  goalId: string;
  cognitiveCycleId: string;
}

export class AuthorizationPackageManager {
  private packages: Map<string, AuthorizationPackage> = new Map();

  /**
   * Create an authorization package for a proposed outreach action.
   */
  createPackage(input: AuthorizationPackageInput): AuthorizationPackage {
    const { prospect, opportunity, offer, draft, goalId, cognitiveCycleId } = input;
    const now = new Date().toISOString();

    const icpEvidence: string[] = [];
    if (prospect.icpFactors) {
      for (const [factor, score] of Object.entries(prospect.icpFactors)) {
        icpEvidence.push(`${factor}: ${score}/100`);
      }
    }

    const evidence: string[] = [
      `Prospect source: ${prospect.source}`,
      `ICP score: ${prospect.icpScore}/100`,
      `ICP factors: ${icpEvidence.join(', ')}`,
      `Opportunity status: ${opportunity.status}`,
      `Offer: ${offer.name} ($${(offer.setupPrice / 100).toFixed(2)} setup + $${(offer.recurringPrice / 100).toFixed(2)}/mo)`,
      `Draft evidence: ${draft.evidenceUsed.knownFacts.length} known facts, ${draft.evidenceUsed.unknownFacts.length} unknown facts`,
      `Cognitive cycle: ${cognitiveCycleId}`,
      `Goal: ${goalId}`,
    ];

    const pkg: AuthorizationPackage = {
      packageId: `authpkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,

      prospectId: prospect.prospectId,
      companyName: prospect.companyName,
      contactName: prospect.contactName,
      contactEmail: prospect.contactEmail,
      source: prospect.source,

      icpScore: prospect.icpScore,
      icpFactors: prospect.icpFactors,
      icpEvidence,

      opportunityId: opportunity.opportunityId,
      offerId: offer.offerId,
      offerName: offer.name,
      priceCents: opportunity.proposedPrice,
      expectedValueCents: opportunity.proposedPrice + offer.recurringPrice * 12,
      expectedMonthlyCents: offer.recurringPrice,

      proposedAction: 'send_outreach_message',
      proposedMessage: {
        channel: draft.messageChannel,
        subject: draft.messageSubject,
        body: draft.messageBody,
      },

      riskLevel: 'R2',
      authorizationMode: 'human_required',
      reasonAuthorizationRequired:
        'At autonomy Level 2, outbound commercial messaging requires explicit human authorization. HEIDI may prepare drafts but must not send unsolicited messages autonomously.',

      goalId,
      cognitiveCycleId,
      evidence,

      decision: 'pending',
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
    };

    this.packages.set(pkg.packageId, pkg);
    return pkg;
  }

  /**
   * Get a package by ID.
   */
  getPackage(packageId: string): AuthorizationPackage | null {
    return this.packages.get(packageId) || null;
  }

  /**
   * Get all pending packages.
   */
  getPendingPackages(): AuthorizationPackage[] {
    return Array.from(this.packages.values()).filter((p) => p.decision === 'pending');
  }

  /**
   * Approve a package. This is the ONLY way to authorize the action.
   * Approval must be explicit — it is never inferred.
   */
  approve(packageId: string, approvedBy: string, reason?: string): AuthorizationPackage | null {
    const pkg = this.packages.get(packageId);
    if (!pkg) return null;
    if (pkg.decision !== 'pending') return null; // Already decided

    pkg.decision = 'approved';
    pkg.decidedAt = new Date().toISOString();
    pkg.decidedBy = approvedBy;
    pkg.decisionReason = reason || 'Approved by human owner';
    return pkg;
  }

  /**
   * Reject a package.
   */
  reject(packageId: string, rejectedBy: string, reason?: string): AuthorizationPackage | null {
    const pkg = this.packages.get(packageId);
    if (!pkg) return null;
    if (pkg.decision !== 'pending') return null;

    pkg.decision = 'rejected';
    pkg.decidedAt = new Date().toISOString();
    pkg.decidedBy = rejectedBy;
    pkg.decisionReason = reason || 'Rejected by human owner';
    return pkg;
  }

  /**
   * Check if a package has been approved.
   */
  isApproved(packageId: string): boolean {
    const pkg = this.packages.get(packageId);
    return pkg?.decision === 'approved';
  }

  /**
   * Get all packages (for audit/reporting).
   */
  getAllPackages(): AuthorizationPackage[] {
    return Array.from(this.packages.values());
  }
}
