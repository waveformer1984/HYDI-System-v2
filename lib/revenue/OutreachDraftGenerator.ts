/**
 * Outreach Draft Generator
 *
 * Generates personalized outreach drafts based on ACTUAL EVIDENCE about a prospect.
 * Does NOT hallucinate pain points, employees, technology, customers, revenue,
 * business problems, or prior interactions.
 *
 * Every draft includes:
 * - prospect ID
 * - opportunity ID
 * - offer
 * - proposed value
 * - message
 * - evidence used
 * - cognitive cycle ID
 * - goal ID
 * - authorization state
 *
 * The CommunicationLayer remains the only communication execution boundary.
 * This module only prepares drafts — it does NOT send messages.
 */

import type { ProspectRecord, OpportunityRecord, OfferId, CommercialOffer } from './types';

export interface OutreachDraft {
  draftId: string;
  prospectId: string;
  opportunityId: string;
  offerId: OfferId;
  proposedValueCents: number;
  messageChannel: 'email' | 'sms' | 'linkedin';
  messageSubject: string;
  messageBody: string;
  evidenceUsed: OutreachEvidence;
  cognitiveCycleId: string;
  goalId: string;
  authorizationState: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'sent';
  createdAt: string;
}

export interface OutreachEvidence {
  prospectSource: string;
  prospectIndustry: string | null;
  prospectLocation: string | null;
  prospectWebsite: string | null;
  icpScore: number;
  icpFactors: Record<string, number>;
  offerName: string;
  offerPriceCents: number;
  offerCategory: string;
  // Only includes facts that are actually known — no hallucinated data
  knownFacts: string[];
  unknownFacts: string[]; // Explicitly listed to prevent hallucination
}

export interface OutreachDraftInput {
  prospect: ProspectRecord;
  opportunity: OpportunityRecord;
  offer: CommercialOffer;
  cognitiveCycleId: string;
  goalId: string;
  channel?: 'email' | 'sms' | 'linkedin';
}

export class OutreachDraftGenerator {
  /**
   * Generate a personalized outreach draft based on actual prospect evidence.
   *
   * The message is built ONLY from verified prospect data:
   * - Company name (from prospect record)
   * - Industry (from prospect record, if known)
   * - Location (from prospect record, if known)
   * - ICP score factors (from scoring)
   * - Offer details (from offer catalog)
   *
   * It does NOT fabricate:
   * - Pain points not evidenced by ICP scoring factors
   * - Employee count (unless in prospect metadata)
   * - Technology stack (unless in prospect metadata)
   * - Customer names
   * - Revenue figures
   * - Prior interactions
   */
  generateDraft(input: OutreachDraftInput): OutreachDraft {
    const { prospect, opportunity, offer, cognitiveCycleId, goalId } = input;
    const channel = input.channel || 'email';
    const now = new Date().toISOString();

    // Build evidence record — only what is actually known
    const knownFacts: string[] = [];
    const unknownFacts: string[] = [];

    knownFacts.push(`Company: ${prospect.companyName}`);
    if (prospect.industry) {
      knownFacts.push(`Industry: ${prospect.industry}`);
    } else {
      unknownFacts.push('Industry: unknown');
    }
    if (prospect.location) {
      knownFacts.push(`Location: ${prospect.location}`);
    } else {
      unknownFacts.push('Location: unknown');
    }
    if (prospect.website) {
      knownFacts.push(`Website: ${prospect.website}`);
    } else {
      unknownFacts.push('Website: unknown');
    }
    knownFacts.push(`ICP Score: ${prospect.icpScore}/100`);
    knownFacts.push(`Source: ${prospect.source}`);

    // Check metadata for additional known facts
    if (prospect.metadata) {
      const meta = prospect.metadata as Record<string, unknown>;
      if (meta.employeeCount) knownFacts.push(`Employees: ${meta.employeeCount}`);
      if (meta.annualRevenue) knownFacts.push(`Annual Revenue: $${meta.annualRevenue}`);
    }

    // Explicitly list what we DON'T know — prevents hallucination
    unknownFacts.push('Specific pain points: not investigated');
    unknownFacts.push('Technology stack: not analyzed');
    unknownFacts.push('Current providers: unknown');
    unknownFacts.push('Prior interactions: none recorded');

    const evidence: OutreachEvidence = {
      prospectSource: prospect.source,
      prospectIndustry: prospect.industry,
      prospectLocation: prospect.location,
      prospectWebsite: prospect.website,
      icpScore: prospect.icpScore,
      icpFactors: prospect.icpFactors,
      offerName: offer.name,
      offerPriceCents: offer.setupPrice,
      offerCategory: offer.category,
      knownFacts,
      unknownFacts,
    };

    // Build message — only using known facts
    const subject = this.generateSubject(prospect, offer);
    const body = this.generateBody(prospect, offer, evidence);

    return {
      draftId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      prospectId: prospect.prospectId,
      opportunityId: opportunity.opportunityId,
      offerId: offer.offerId,
      proposedValueCents: opportunity.proposedPrice,
      messageChannel: channel,
      messageSubject: subject,
      messageBody: body,
      evidenceUsed: evidence,
      cognitiveCycleId,
      goalId,
      authorizationState: 'draft',
      createdAt: now,
    };
  }

  private generateSubject(prospect: ProspectRecord, offer: CommercialOffer): string {
    return `AI Operations Setup for ${prospect.companyName}`;
  }

  private generateBody(
    prospect: ProspectRecord,
    offer: CommercialOffer,
    evidence: OutreachEvidence,
  ): string {
    const greeting = prospect.contactName
      ? `Hi ${prospect.contactName},`
      : `Hi ${prospect.companyName} team,`;

    const industryContext = prospect.industry
      ? `I noticed you're in the ${prospect.industry} industry`
      : `I came across ${prospect.companyName}`;

    const locationContext = prospect.location
      ? ` based in ${prospect.location}`
      : '';

    const body = `${greeting}

${industryContext}${locationContext}. We help businesses like yours set up AI-powered operations that automate routine tasks, improve response times, and reduce manual workload.

Our AI Operations Setup includes:
- AI-powered lead capture and qualification
- Automated customer communication workflows
- Monitoring and analytics dashboard
- Integration with your existing tools

The setup is a one-time fee of $${(offer.setupPrice / 100).toFixed(2)}, with an optional monthly service at $${(offer.recurringPrice / 100).toFixed(2)}/month for ongoing optimization and support.

Would you be interested in a brief discovery call to see if this is a fit?

Best regards,
HEIDI (on behalf of the ProtoForge team)

---
This message was prepared by HEIDI's autonomous outreach system and requires human approval before sending.
Evidence: ICP Score ${evidence.icpScore}/100, Source: ${evidence.prospectSource}`;

    return body;
  }
}
