/**
 * Commercial Workflow
 *
 * Orchestrates the full prospect-to-payment commercial workflow:
 *
 * DISCOVER → DEDUPLICATE → TRUST CHECK → ICP SCORE → QUALIFY →
 * PRIORITIZE → CREATE OPPORTUNITY → PREPARE OUTREACH →
 * REQUEST AUTHORIZATION → HUMAN APPROVAL → SEND →
 * RECEIVE RESPONSE → CLASSIFY → FOLLOW UP → CONVERT →
 * ONBOARD → PAYMENT → VERIFY → RECORD REVENUE → LEARN
 *
 * This module coordinates between:
 * - ProspectDiscoveryAdapter (discovery)
 * - ProspectPipeline (qualification, scoring, opportunities)
 * - OutreachDraftGenerator (draft preparation)
 * - AuthorizationPackageManager (human approval)
 * - CommunicationLayer (message delivery — R2, requires authorization)
 * - InboundResponseHandler (response classification)
 * - CustomerLifecycle (customer creation, service activation)
 * - StripeBridge (payment processing — BLOCKED without credentials)
 * - RevenueLedger (verified revenue recording)
 *
 * It does NOT bypass any governance. It does NOT fabricate data.
 * It does NOT send messages without authorization.
 * It does NOT claim revenue without verified payment evidence.
 */

import { ProspectPipeline } from './ProspectPipeline';
import { RevenueLedger } from './RevenueLedger';
import { CustomerLifecycle } from './CustomerLifecycle';
import { ProspectDiscoveryAdapter, type DiscoveredProspect, type DiscoveryResult } from './ProspectDiscoveryAdapter';
import { OutreachDraftGenerator, type OutreachDraft } from './OutreachDraftGenerator';
import { AuthorizationPackageManager, type AuthorizationPackage } from './AuthorizationPackage';
import { InboundResponseHandler, type InboundMessage, type InboundResponseResult } from './InboundResponseHandler';
import { type OfferId, type ProspectRecord, type OpportunityRecord } from './types';
import { getOfferCatalog } from './OfferCatalog';

export interface CommercialWorkflowResult {
  success: boolean;
  stage: string;
  blocked: boolean;
  blockerReason: string | null;
  data: Record<string, unknown>;
}

export interface CommercialWorkflowState {
  discoveryAvailable: boolean;
  discoveryBlocker: string | null;
  stripeAvailable: boolean;
  stripeBlocker: string | null;
  emailAvailable: boolean;
  emailBlocker: string | null;
  prospectsDiscovered: number;
  prospectsQualified: number;
  opportunitiesCreated: number;
  outreachDraftsPrepared: number;
  authorizationPackagesCreated: number;
  authorizationPackagesApproved: number;
  messagesSent: number;
  responsesReceived: number;
  customersCreated: number;
  servicesActivated: number;
  paymentsProcessed: number;
  verifiedRevenueCents: number;
  pipelineValueCents: number;
}

export class CommercialWorkflow {
  private pipeline: ProspectPipeline;
  private ledger: RevenueLedger;
  private lifecycle: CustomerLifecycle;
  private discovery: ProspectDiscoveryAdapter;
  private draftGenerator: OutreachDraftGenerator;
  private authManager: AuthorizationPackageManager;
  private inboundHandler: InboundResponseHandler;

  constructor(deps: {
    pipeline: ProspectPipeline;
    ledger: RevenueLedger;
    lifecycle: CustomerLifecycle;
    discovery?: ProspectDiscoveryAdapter;
  }) {
    this.pipeline = deps.pipeline;
    this.ledger = deps.ledger;
    this.lifecycle = deps.lifecycle;
    this.discovery = deps.discovery || new ProspectDiscoveryAdapter();
    this.draftGenerator = new OutreachDraftGenerator();
    this.authManager = new AuthorizationPackageManager();
    this.inboundHandler = new InboundResponseHandler();
  }

  /**
   * Get the current workflow state — what's available, what's blocked,
   * and current pipeline metrics.
   */
  async getState(): Promise<CommercialWorkflowState> {
    const metrics = await this.pipeline.getPipelineMetrics();
    const verifiedRevenue = await this.ledger.getVerifiedRevenue();
    const pipelineValue = 0; // Would be computed from open opportunities

    // Check Stripe availability
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const stripeAvailable = !!stripeKey;
    const stripeBlocker = stripeAvailable
      ? null
      : 'STRIPE_SECRET_KEY is not set. Payment processing and checkout creation are BLOCKED. Required: STRIPE_SECRET_KEY (sk_test_ or rk_live_) and STRIPE_WEBHOOK_SECRET (whsec_).';

    // Check email availability
    const emailKey = process.env.SENDGRID_API_KEY || process.env.SMTP_HOST;
    const emailAvailable = !!emailKey;
    const emailBlocker = emailAvailable
      ? null
      : 'No email provider configured. Outbound email delivery is BLOCKED. Required: SENDGRID_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.';

    return {
      discoveryAvailable: this.discovery.isAvailable(),
      discoveryBlocker: this.discovery.getBlockerReason(),
      stripeAvailable,
      stripeBlocker,
      emailAvailable,
      emailBlocker,
      prospectsDiscovered: metrics.total || 0,
      prospectsQualified: (metrics.byStatus.qualified || 0) + (metrics.byStatus.appointment || 0) + (metrics.byStatus.proposal_sent || 0) + (metrics.byStatus.won || 0),
      opportunitiesCreated: 0, // Would be queried from revenue_opportunities
      outreachDraftsPrepared: 0,
      authorizationPackagesCreated: this.authManager.getPendingPackages().length,
      authorizationPackagesApproved: this.authManager.getAllPackages().filter((p) => p.decision === 'approved').length,
      messagesSent: 0,
      responsesReceived: 0,
      customersCreated: 0,
      servicesActivated: 0,
      paymentsProcessed: verifiedRevenue.length,
      verifiedRevenueCents: verifiedRevenue.reduce((s, e) => s + e.amountGross, 0),
      pipelineValueCents: pipelineValue,
    };
  }

  /**
   * STAGE 1: Discover prospects from external sources.
   * BLOCKED if no discovery provider credentials are available.
   */
  async discoverProspects(query: {
    industry?: string;
    location?: string;
    maxResults?: number;
  }): Promise<DiscoveryResult> {
    return this.discovery.discover(query);
  }

  /**
   * STAGE 2: Ingest a discovered prospect into the pipeline.
   * Deduplicates, scores, and qualifies.
   */
  async ingestProspect(discovered: DiscoveredProspect): Promise<{
    prospect: ProspectRecord;
    created: boolean;
    score: number;
    qualified: boolean;
  }> {
    // Ingest into pipeline (handles dedup)
    const result = await this.pipeline.identifyProspect({
      companyName: discovered.companyName,
      contactName: discovered.contactName,
      contactEmail: discovered.contactEmail,
      contactPhone: discovered.contactPhone,
      website: discovered.website,
      industry: discovered.industry,
      location: discovered.location,
      source: discovered.source,
      metadata: {
        ...discovered.metadata,
        discoveryEvidence: discovered.discoveryEvidence,
        sourceUrl: discovered.sourceUrl,
      },
    });

    // Score the prospect
    const scoreResult = await this.pipeline.scoreProspect(result.prospect.prospectId);

    // Qualify: score >= 50 is considered qualified
    const qualified = scoreResult.score >= 50;

    return {
      prospect: result.prospect,
      created: result.created,
      score: scoreResult.score,
      qualified,
    };
  }

  /**
   * STAGE 3: Create an opportunity for a qualified prospect.
   */
  async createOpportunityForProspect(
    prospectId: string,
    offerId: OfferId = 'ai_operations_setup',
  ): Promise<OpportunityRecord | null> {
    const prospect = await this.pipeline.getProspect(prospectId);
    if (!prospect) return null;

    const offer = getOfferCatalog().get(offerId);
    if (!offer) return null;

    // Only create opportunity for qualified prospects
    if (prospect.icpScore < 50) {
      return null;
    }

    const opp = await this.pipeline.createOpportunity({
      prospectId,
      offerId,
      proposedPrice: offer.setupPrice,
      estimatedValue: offer.setupPrice + offer.recurringPrice * 12,
      probability: 0.3 + (prospect.icpScore / 100) * 0.4,
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });

    return opp;
  }

  /**
   * STAGE 4: Prepare an outreach draft for a qualified opportunity.
   * This is R0 — HEIDI may autonomously prepare drafts.
   */
  prepareOutreachDraft(
    prospect: ProspectRecord,
    opportunity: OpportunityRecord,
    offerId: OfferId,
    cognitiveCycleId: string,
    goalId: string,
  ): OutreachDraft {
    const offer = getOfferCatalog().get(offerId);
    if (!offer) throw new Error(`Unknown offer: ${offerId}`);

    return this.draftGenerator.generateDraft({
      prospect,
      opportunity,
      offer,
      cognitiveCycleId,
      goalId,
    });
  }

  /**
   * STAGE 5: Create an authorization package for the outreach.
   * This is R0 — HEIDI may autonomously create authorization packages.
   * The package must be approved by a human before the message is sent.
   */
  createAuthorizationPackage(
    prospect: ProspectRecord,
    opportunity: OpportunityRecord,
    draft: OutreachDraft,
    goalId: string,
    cognitiveCycleId: string,
  ): AuthorizationPackage {
    const offer = getOfferCatalog().get(draft.offerId);
    if (!offer) throw new Error(`Unknown offer: ${draft.offerId}`);

    return this.authManager.createPackage({
      prospect,
      opportunity,
      offer,
      draft,
      goalId,
      cognitiveCycleId,
    });
  }

  /**
   * STAGE 6: Human approves an authorization package.
   * This is the ONLY way to authorize sending an outbound message.
   */
  approveAuthorizationPackage(
    packageId: string,
    approvedBy: string,
    reason?: string,
  ): AuthorizationPackage | null {
    return this.authManager.approve(packageId, approvedBy, reason);
  }

  /**
   * STAGE 7: Send the approved message.
   * This is R2 — requires human approval.
   * BLOCKED if no email/SMS provider is configured.
   *
   * NOTE: This method does NOT send the message directly.
   * It returns the authorization state. The actual sending
   * must go through the CommunicationLayer, which enforces
   * its own kill switch, rate limits, and policies.
   */
  async sendApprovedMessage(packageId: string): Promise<CommercialWorkflowResult> {
    const pkg = this.authManager.getPackage(packageId);
    if (!pkg) {
      return { success: false, stage: 'send', blocked: true, blockerReason: 'Authorization package not found', data: {} };
    }

    if (pkg.decision !== 'approved') {
      return { success: false, stage: 'send', blocked: true, blockerReason: 'Authorization package not approved', data: {} };
    }

    // Check if email provider is available
    const emailKey = process.env.SENDGRID_API_KEY || process.env.SMTP_HOST;
    if (!emailKey) {
      return {
        success: false,
        stage: 'send',
        blocked: true,
        blockerReason: 'No email provider configured. Required: SENDGRID_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.',
        data: { packageId, prospectId: pkg.prospectId },
      };
    }

    // If we had an email provider, we would call CommunicationLayer.sendMessage here.
    // The CommunicationLayer enforces its own kill switch, rate limits, and policies.
    // This is the integration point — it requires a real email provider to be configured.

    return {
      success: false,
      stage: 'send',
      blocked: true,
      blockerReason: 'Email provider integration point — not yet wired to CommunicationLayer (requires provider credentials).',
      data: { packageId, prospectId: pkg.prospectId },
    };
  }

  /**
   * STAGE 8: Process an inbound response from a prospect.
   * This is R0 — HEIDI may autonomously receive, classify, and store responses.
   */
  async processInboundResponse(
    message: InboundMessage,
    prospects: ProspectRecord[],
    opportunities: OpportunityRecord[],
  ): Promise<InboundResponseResult> {
    return this.inboundHandler.processInbound(message, prospects, opportunities);
  }

  /**
   * STAGE 9: Convert an accepted opportunity to a customer.
   * This is R2 — requires human authorization.
   * Requires evidence of acceptance (not just opportunity existence).
   */
  async convertToCustomer(
    opportunityId: string,
    acceptanceEvidence: {
      source: string;
      evidence: string;
      acceptedBy: string;
    },
  ): Promise<CommercialWorkflowResult> {
    // Verify the opportunity exists and is in 'accepted' status
    // (not just 'open' — must have evidence of acceptance)
    // In a real implementation, we'd query the opportunity by ID
    // and verify its status is 'accepted'

    if (!acceptanceEvidence.evidence) {
      return {
        success: false,
        stage: 'convert',
        blocked: true,
        blockerReason: 'No acceptance evidence provided. Customer creation requires evidence of genuine acceptance.',
        data: { opportunityId },
      };
    }

    // Create customer through CustomerLifecycle
    // This is R2 — requires human authorization at Level 2
    return {
      success: false,
      stage: 'convert',
      blocked: true,
      blockerReason: 'Customer conversion requires R2 authorization. At Level 2, this must be explicitly authorized by a human.',
      data: { opportunityId, acceptanceEvidence },
    };
  }

  /**
   * STAGE 10: Process payment through Stripe.
   * BLOCKED without STRIPE_SECRET_KEY.
   */
  async processPayment(opportunityId: string): Promise<CommercialWorkflowResult> {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return {
        success: false,
        stage: 'payment',
        blocked: true,
        blockerReason: 'STRIPE_SECRET_KEY is not set. Payment processing is BLOCKED. Required: STRIPE_SECRET_KEY (sk_test_ or rk_live_) and STRIPE_WEBHOOK_SECRET (whsec_).',
        data: { opportunityId },
      };
    }

    // If we had Stripe keys, we would:
    // 1. Create a checkout session via StripeBridge
    // 2. Send the checkout URL to the customer
    // 3. Wait for the Stripe webhook to confirm payment
    // 4. Record the verified event in RevenueLedger
    //
    // This is the integration point — it requires real Stripe credentials.

    return {
      success: false,
      stage: 'payment',
      blocked: true,
      blockerReason: 'Stripe integration point — requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to process payments.',
      data: { opportunityId },
    };
  }

  /**
   * STAGE 11: Verify revenue from the authoritative RevenueLedger.
   * Only verified payment-provider events establish revenue.
   */
  async verifyRevenue(): Promise<{
    verifiedRevenueCents: number;
    entries: Array<{ amount: number; eventType: string; verified: boolean; verifiedAt: string | null }>;
  }> {
    const entries = await this.ledger.getVerifiedRevenue();
    return {
      verifiedRevenueCents: entries.reduce((s, e) => s + e.amountGross, 0),
      entries: entries.map((e) => ({
        amount: e.amountGross,
        eventType: e.eventType,
        verified: e.verified,
        verifiedAt: e.verifiedAt,
      })),
    };
  }

  /**
   * Get the authorization package manager (for testing/inspection).
   */
  getAuthManager(): AuthorizationPackageManager {
    return this.authManager;
  }

  /**
   * Get the discovery adapter (for testing/inspection).
   */
  getDiscoveryAdapter(): ProspectDiscoveryAdapter {
    return this.discovery;
  }

  /**
   * Get the draft generator (for testing/inspection).
   */
  getDraftGenerator(): OutreachDraftGenerator {
    return this.draftGenerator;
  }

  /**
   * Get the inbound handler (for testing/inspection).
   */
  getInboundHandler(): InboundResponseHandler {
    return this.inboundHandler;
  }
}
