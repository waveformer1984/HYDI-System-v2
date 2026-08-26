/**
 * Revenue Engine Test Suite
 *
 * Tests the full commercial lifecycle:
 *   1. Offer catalog — configurable offers and pricing
 *   2. Financial guardrails — authorization and limits
 *   3. Prospect pipeline — ICP scoring, dedup, compliance
 *   4. Revenue ledger — idempotent recording, MRR calculation
 *   5. Customer lifecycle — onboarding, provisioning, fulfillment
 *   6. Revenue control loop — action selection and execution
 *
 * These tests use direct PostgreSQL access (not PostgREST) for reliability.
 * They do NOT require Stripe — the Stripe bridge is tested in disabled mode.
 */

import {
  OfferCatalog,
  getOfferCatalog,
  GuardrailEngine,
  getGuardrailEngine,
  ProspectPipeline,
  RevenueLedger,
  CustomerLifecycle,
  RevenueControlLoop,
  StripeBridge,
  RevenueDatabase,
  PRODUCTION_ACTIVATION_REQUIREMENTS,
} from '../../lib/revenue/index';
import type {
  CommercialOffer,
  OfferId,
  ProspectRecord,
  RevenueActionType,
  FinancialGuardrails,
} from '../../lib/revenue/types';

// Use direct PG access — always available when local Supabase is running
const describeWithDB = describe;

// ---------------------------------------------------------------------------
// 1. Offer Catalog Tests
// ---------------------------------------------------------------------------

describe('OfferCatalog', () => {
  let catalog: OfferCatalog;

  beforeEach(() => {
    catalog = new OfferCatalog();
  });

  test('has all 7 default offers', () => {
    const offers = catalog.getAll();
    expect(offers.length).toBe(7);
  });

  test('all default offers are active', () => {
    const active = catalog.getActive();
    expect(active.length).toBe(7);
  });

  test('AI Operations Setup has correct pricing', () => {
    const offer = catalog.get('ai_operations_setup');
    expect(offer).not.toBeNull();
    expect(offer!.setupPrice).toBe(50000);
    expect(offer!.recurringPrice).toBe(0);
    expect(offer!.billingInterval).toBe('one_time');
  });

  test('AI Operations Monthly has correct pricing', () => {
    const offer = catalog.get('ai_operations_monthly');
    expect(offer).not.toBeNull();
    expect(offer!.setupPrice).toBe(0);
    expect(offer!.recurringPrice).toBe(29900);
    expect(offer!.billingInterval).toBe('monthly');
  });

  test('offers can be configured with custom pricing', () => {
    catalog.configure('ai_operations_monthly', { recurringPrice: 49900 });
    const offer = catalog.get('ai_operations_monthly');
    expect(offer!.recurringPrice).toBe(49900);
  });

  test('recommendOffer returns AI Operations for default needs', () => {
    const rec = catalog.recommendOffer([]);
    expect(rec.recommended).toBe('ai_operations_setup');
  });

  test('recommendOffer returns website setup for website needs', () => {
    const rec = catalog.recommendOffer(['website', 'chatbot']);
    expect(rec.recommended).toBe('ai_website_setup');
  });

  test('recommendOffer returns lead gen for lead needs', () => {
    const rec = catalog.recommendOffer(['leads', 'appointments']);
    expect(rec.recommended).toBe('lead_gen_setup');
  });

  test('getFirstMonthCost includes setup + first recurring', () => {
    const cost = catalog.getFirstMonthCost('ai_operations_setup');
    expect(cost).toBe(50000);

    catalog.configure('ai_operations_setup', { recurringPrice: 10000 });
    const cost2 = catalog.getFirstMonthCost('ai_operations_setup');
    expect(cost2).toBe(60000);
  });

  test('getAnnualCost calculates correctly for monthly', () => {
    const cost = catalog.getAnnualCost('ai_operations_monthly');
    expect(cost).toBe(29900 * 12);
  });

  test('getByCategory filters correctly', () => {
    const aiOps = catalog.getByCategory('ai_operations');
    expect(aiOps.length).toBe(2);
    const web = catalog.getByCategory('website_deployment');
    expect(web.length).toBe(2);
    const leadGen = catalog.getByCategory('lead_generation');
    expect(leadGen.length).toBe(2);
  });

  test('configure throws for unknown offer', () => {
    expect(() => catalog.configure('nonexistent' as OfferId, {})).toThrow('Unknown offer');
  });
});

// ---------------------------------------------------------------------------
// 2. Financial Guardrails Tests
// ---------------------------------------------------------------------------

describe('GuardrailEngine', () => {
  let guardrails: GuardrailEngine;

  beforeEach(() => {
    guardrails = new GuardrailEngine();
  });

  test('R0 actions are autonomous', () => {
    const result = guardrails.authorize('prospect_research', 0);
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe('autonomous');
  });

  test('R1 actions are autonomous', () => {
    const result = guardrails.authorize('prospect_outreach', 0);
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe('autonomous');
  });

  test('R2 actions within limits are policy_authorized', () => {
    const result = guardrails.authorize('customer_onboard', 10000);
    expect(result.authorized).toBe(true);
    expect(result.mode).toBe('policy_authorized');
  });

  test('R2 actions above financial threshold require human', () => {
    const result = guardrails.authorize('customer_onboard', 60000);
    expect(result.authorized).toBe(false);
    expect(result.mode).toBe('human_required');
  });

  test('R3 actions always require human', () => {
    const result = guardrails.authorize('price_change', 0);
    expect(result.authorized).toBe(false);
    expect(result.mode).toBe('human_required');
  });

  test('refund_issue requires human', () => {
    const result = guardrails.authorize('refund_issue', 0);
    expect(result.authorized).toBe(false);
    expect(result.mode).toBe('human_required');
  });

  test('discount within autonomous limit is allowed', () => {
    const result = guardrails.authorize('discount_offer', 0, { discountAmount: 3000 });
    expect(result.authorized).toBe(true);
  });

  test('discount above autonomous limit requires human', () => {
    const result = guardrails.authorize('discount_offer', 0, { discountAmount: 10000 });
    expect(result.authorized).toBe(false);
    expect(result.mode).toBe('human_required');
  });

  test('prohibited actions are denied', () => {
    const result = guardrails.authorize('prospect_outreach', 0, { isProhibitedAction: true });
    expect(result.authorized).toBe(false);
    expect(result.mode).toBe('prohibited');
  });

  test('unknown action type is prohibited', () => {
    const result = guardrails.authorize('unknown_action' as RevenueActionType, 0);
    expect(result.authorized).toBe(false);
    expect(result.mode).toBe('prohibited');
  });

  test('isDiscountAllowed respects limit', () => {
    expect(guardrails.isDiscountAllowed(3000).allowed).toBe(true);
    expect(guardrails.isDiscountAllowed(10000).allowed).toBe(false);
  });

  test('isRefundAllowed respects limit', () => {
    expect(guardrails.isRefundAllowed(2000).allowed).toBe(true);
    expect(guardrails.isRefundAllowed(5000).allowed).toBe(false);
  });

  test('isOutreachWithinLimit respects daily limit', () => {
    expect(guardrails.isOutreachWithinLimit(10).allowed).toBe(true);
    expect(guardrails.isOutreachWithinLimit(50).allowed).toBe(false);
  });

  test('isMarginAcceptable respects minimum', () => {
    expect(guardrails.isMarginAcceptable(0.50).acceptable).toBe(true);
    expect(guardrails.isMarginAcceptable(0.30).acceptable).toBe(false);
  });

  test('guardrails can be configured', () => {
    guardrails.configure({ maxAutonomousDiscount: 10000 });
    expect(guardrails.isDiscountAllowed(8000).allowed).toBe(true);
  });

  test('getRiskLevel returns correct level', () => {
    expect(guardrails.getRiskLevel('prospect_research')).toBe('R0');
    expect(guardrails.getRiskLevel('prospect_outreach')).toBe('R1');
    expect(guardrails.getRiskLevel('customer_onboard')).toBe('R2');
    expect(guardrails.getRiskLevel('price_change')).toBe('R3');
  });
});

// ---------------------------------------------------------------------------
// 3. Stripe Bridge Tests (disabled mode — no Stripe key)
// ---------------------------------------------------------------------------

describe('StripeBridge (disabled mode)', () => {
  let bridge: StripeBridge;

  beforeEach(() => {
    bridge = new StripeBridge();
  });

  test('is disabled when STRIPE_SECRET_KEY is not set', () => {
    if (!process.env.STRIPE_SECRET_KEY) {
      expect(bridge.isConfigured()).toBe(false);
      expect(bridge.getMode()).toBe('disabled');
    }
  });

  test('createSetupCheckoutSession returns error when disabled', async () => {
    if (!process.env.STRIPE_SECRET_KEY) {
      const result = await bridge.createSetupCheckoutSession({
        offerId: 'ai_operations_setup',
        customerEmail: 'test@example.com',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });
      expect('error' in result).toBe(true);
    }
  });

  test('createSubscriptionCheckoutSession returns error when disabled', async () => {
    if (!process.env.STRIPE_SECRET_KEY) {
      const result = await bridge.createSubscriptionCheckoutSession({
        offerId: 'ai_operations_monthly',
        customerEmail: 'test@example.com',
        priceId: 'price_test123',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });
      expect('error' in result).toBe(true);
    }
  });

  test('verifyWebhook returns null when disabled', async () => {
    if (!process.env.STRIPE_SECRET_KEY) {
      const result = await bridge.verifyWebhook('payload', 'signature', 'whsec_test');
      expect(result).toBeNull();
    }
  });

  test('PRODUCTION_ACTIVATION_REQUIREMENTS is documented', () => {
    expect(PRODUCTION_ACTIVATION_REQUIREMENTS.stripeAccount).toBeDefined();
    expect(PRODUCTION_ACTIVATION_REQUIREMENTS.stripeSecretKey).toBeDefined();
    expect(PRODUCTION_ACTIVATION_REQUIREMENTS.webhookSecret).toBeDefined();
    expect(PRODUCTION_ACTIVATION_REQUIREMENTS.allowLiveStripe).toBeDefined();
    expect(PRODUCTION_ACTIVATION_REQUIREMENTS.notes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Prospect Pipeline Tests (requires PostgreSQL)
// ---------------------------------------------------------------------------

describeWithDB('ProspectPipeline', () => {
  let db: RevenueDatabase;
  let pipeline: ProspectPipeline;

  beforeAll(() => {
    db = new RevenueDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    pipeline = new ProspectPipeline(undefined, db);
  });

  test('identifies a new prospect', async () => {
    const result = await pipeline.identifyProspect({
      companyName: `Test Company ${Date.now()}`,
      contactEmail: `test${Date.now()}@example.com`,
      industry: 'contractor',
      source: 'authorized_test',
    });

    expect(result.created).toBe(true);
    expect(result.prospect.companyName).toContain('Test Company');
    expect(result.prospect.status).toBe('identified');
    expect(result.prospect.icpScore).toBe(0);
  });

  test('deduplicates by email', async () => {
    const email = `dedup${Date.now()}@example.com`;
    const company = `Dedup Test ${Date.now()}`;

    const first = await pipeline.identifyProspect({
      companyName: company,
      contactEmail: email,
      source: 'authorized_test',
    });

    const second = await pipeline.identifyProspect({
      companyName: company + ' Different',
      contactEmail: email,
      source: 'authorized_test',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.dedupMatch).toBe('email');
  });

  test('scores a prospect against ICP', async () => {
    const result = await pipeline.identifyProspect({
      companyName: `Score Test ${Date.now()}`,
      contactEmail: `score${Date.now()}@example.com`,
      industry: 'contractor',
      source: 'authorized_test',
      metadata: { employeeCount: 10, hasLeadCapture: false, responseTimeHours: 48 },
    });

    const scoring = await pipeline.scoreProspect(result.prospect.prospectId);
    expect(scoring.score).toBeGreaterThan(0);
    expect(scoring.score).toBeLessThanOrEqual(100);
    expect(scoring.factors.industryFit).toBeDefined();
    expect(scoring.factors.leadCaptureGap).toBeDefined();
  });

  test('updates prospect status with valid transition', async () => {
    const result = await pipeline.identifyProspect({
      companyName: `Status Test ${Date.now()}`,
      contactEmail: `status${Date.now()}@example.com`,
      source: 'authorized_test',
    });

    const scored = await pipeline.updateStatus(result.prospect.prospectId, 'scored');
    expect(scored.status).toBe('scored');
  });

  test('rejects invalid state transition', async () => {
    const result = await pipeline.identifyProspect({
      companyName: `Invalid Transition ${Date.now()}`,
      contactEmail: `invalid${Date.now()}@example.com`,
      source: 'authorized_test',
    });

    await expect(
      pipeline.updateStatus(result.prospect.prospectId, 'won'),
    ).rejects.toThrow('Invalid state transition');
  });

  test('processes opt-out and prevents further contact', async () => {
    const email = `optout${Date.now()}@example.com`;
    const result = await pipeline.identifyProspect({
      companyName: `Opt Out Test ${Date.now()}`,
      contactEmail: email,
      source: 'authorized_test',
    });

    await pipeline.processOptOut(result.prospect.prospectId, 'email', email);

    const canContact = await pipeline.canContact(result.prospect.prospectId);
    expect(canContact.allowed).toBe(false);
    expect(canContact.reason).toContain('opted out');
  });

  test('canContact respects frequency limits', async () => {
    const result = await pipeline.identifyProspect({
      companyName: `Frequency Test ${Date.now()}`,
      contactEmail: `freq${Date.now()}@example.com`,
      source: 'authorized_test',
    });

    await pipeline.updateStatus(result.prospect.prospectId, 'scored');
    await pipeline.updateStatus(result.prospect.prospectId, 'contacted');

    const canContact = await pipeline.canContact(result.prospect.prospectId);
    expect(canContact.allowed).toBe(false);
    expect(canContact.reason).toContain('frequency limit');
  });

  test('creates an opportunity for a prospect', async () => {
    const result = await pipeline.identifyProspect({
      companyName: `Opp Test ${Date.now()}`,
      contactEmail: `opp${Date.now()}@example.com`,
      source: 'authorized_test',
    });

    const opp = await pipeline.createOpportunity({
      prospectId: result.prospect.prospectId,
      offerId: 'ai_operations_setup',
      proposedPrice: 50000,
      estimatedValue: 50000,
      probability: 0.3,
    });

    expect(opp.opportunityId).toBeDefined();
    expect(opp.offerId).toBe('ai_operations_setup');
    expect(opp.proposedPrice).toBe(50000);
  });

  test('getPipelineMetrics returns aggregate metrics', async () => {
    const metrics = await pipeline.getPipelineMetrics();
    expect(metrics.total).toBeGreaterThanOrEqual(0);
    expect(metrics.byStatus).toBeDefined();
    expect(metrics.averageScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Revenue Ledger Tests (requires PostgreSQL)
// ---------------------------------------------------------------------------

describeWithDB('RevenueLedger', () => {
  let db: RevenueDatabase;
  let ledger: RevenueLedger;

  beforeAll(() => {
    db = new RevenueDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    ledger = new RevenueLedger(db);
  });

  test('records a verified payment event', async () => {
    const eventId = `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await ledger.recordEvent({
      eventType: 'payment_received',
      source: 'stripe_webhook',
      stripeEventId: eventId,
      stripePaymentIntentId: `pi_test_${Date.now()}`,
      customerId: 'test-customer-001',
      amountGross: 50000,
      amountNet: 48500,
      currency: 'usd',
      feeBreakdown: { platformFee: 0, stripeFee: 1500, otherFees: 0 },
      verified: true,
      metadata: { test: true },
    });

    expect(result.created).toBe(true);
    expect(result.entry.amountGross).toBe(50000);
    expect(result.entry.verified).toBe(true);
  });

  test('is idempotent — same stripe_event_id returns existing entry', async () => {
    const eventId = `evt_idempotent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const input = {
      eventType: 'payment_received' as const,
      source: 'stripe_webhook' as const,
      stripeEventId: eventId,
      customerId: 'test-customer-002',
      amountGross: 29900,
      amountNet: 29000,
      currency: 'usd',
      feeBreakdown: { platformFee: 0, stripeFee: 900, otherFees: 0 },
      verified: true,
    };

    const first = await ledger.recordEvent(input);
    const second = await ledger.recordEvent(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.entry.ledgerEntryId).toBe(second.entry.ledgerEntryId);
  });

  test('isEventProcessed returns true for processed events', async () => {
    const eventId = `evt_processed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await ledger.recordEvent({
      eventType: 'payment_received',
      source: 'stripe_webhook',
      stripeEventId: eventId,
      customerId: 'test-customer-003',
      amountGross: 10000,
      amountNet: 9700,
      currency: 'usd',
      feeBreakdown: { platformFee: 0, stripeFee: 300, otherFees: 0 },
      verified: true,
    });

    const processed = await ledger.isEventProcessed(eventId);
    expect(processed).toBe(true);
  });

  test('calculateMRR returns sum of active subscriptions', async () => {
    const mrr = await ledger.calculateMRR();
    expect(mrr).toBeGreaterThanOrEqual(0);
  });

  test('getRevenueSummary returns comprehensive summary', async () => {
    const summary = await ledger.getRevenueSummary();
    expect(summary.mrr).toBeGreaterThanOrEqual(0);
    expect(summary.arr).toBeGreaterThanOrEqual(0);
    expect(summary.totalRevenue).toBeGreaterThanOrEqual(0);
    expect(summary.customerCount).toBeGreaterThanOrEqual(0);
    expect(summary.entryCount).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Customer Lifecycle Tests (requires PostgreSQL)
// ---------------------------------------------------------------------------

describeWithDB('CustomerLifecycle', () => {
  let db: RevenueDatabase;
  let lifecycle: CustomerLifecycle;

  beforeAll(() => {
    db = new RevenueDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    lifecycle = new CustomerLifecycle(db);
  });

  test('starts onboarding for a new customer', async () => {
    const service = await lifecycle.startOnboarding({
      customerId: `test-customer-${Date.now()}`,
      offerId: 'ai_operations_setup',
      configuration: { test: true },
    });

    expect(service.customerId).toBeDefined();
    expect(service.offerId).toBe('ai_operations_setup');
    expect(service.status).toBe('pending');
    expect(service.fulfillmentSteps.length).toBeGreaterThan(0);
  });

  test('is idempotent — startOnboarding returns existing service', async () => {
    const customerId = `idempotent-customer-${Date.now()}`;
    const first = await lifecycle.startOnboarding({
      customerId,
      offerId: 'ai_operations_monthly',
    });

    const second = await lifecycle.startOnboarding({
      customerId,
      offerId: 'ai_operations_monthly',
    });

    expect(first.serviceId).toBe(second.serviceId);
  });

  test('starts provisioning', async () => {
    const service = await lifecycle.startOnboarding({
      customerId: `provision-customer-${Date.now()}`,
      offerId: 'ai_operations_setup',
    });

    const provisioning = await lifecycle.startProvisioning(service.serviceId);
    expect(provisioning.status).toBe('provisioning');
    expect(provisioning.provisionedAt).not.toBeNull();
  });

  test('updates fulfillment steps', async () => {
    const service = await lifecycle.startOnboarding({
      customerId: `fulfillment-customer-${Date.now()}`,
      offerId: 'ai_operations_setup',
    });

    await lifecycle.startProvisioning(service.serviceId);

    const updated = await lifecycle.updateFulfillmentStep(
      service.serviceId,
      'discovery_call',
      { status: 'in_progress' },
    );

    const step = updated.fulfillmentSteps.find((s) => s.stepId === 'discovery_call');
    expect(step!.status).toBe('in_progress');
    expect(step!.startedAt).not.toBeNull();
  });

  test('activates service when all steps are completed', async () => {
    const service = await lifecycle.startOnboarding({
      customerId: `activate-customer-${Date.now()}`,
      offerId: 'ai_operations_monthly',
    });

    await lifecycle.startProvisioning(service.serviceId);

    for (const step of service.fulfillmentSteps) {
      await lifecycle.updateFulfillmentStep(service.serviceId, step.stepId, {
        status: 'completed',
        result: 'Completed successfully',
      });
    }

    const active = await lifecycle.getService(service.serviceId);
    expect(active!.status).toBe('active');
    expect(active!.activatedAt).not.toBeNull();
  });

  test('suspends and cancels service', async () => {
    const service = await lifecycle.startOnboarding({
      customerId: `suspend-customer-${Date.now()}`,
      offerId: 'ai_operations_setup',
    });

    const suspended = await lifecycle.suspendService(service.serviceId, 'Payment failure');
    expect(suspended.status).toBe('suspended');

    const cancelled = await lifecycle.cancelService(service.serviceId, 'Customer request');
    expect(cancelled.status).toBe('cancelled');
  });

  test('getServicesByStatus returns filtered results', async () => {
    const services = await lifecycle.getServicesByStatus('pending');
    expect(Array.isArray(services)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Revenue Control Loop Tests (requires PostgreSQL)
// ---------------------------------------------------------------------------

describeWithDB('RevenueControlLoop', () => {
  let db: RevenueDatabase;
  let loop: RevenueControlLoop;

  beforeAll(() => {
    db = new RevenueDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    loop = new RevenueControlLoop(db);
  });

  test('collectMetrics returns valid metrics', async () => {
    const metrics = await loop.collectMetrics();
    expect(metrics.totalProspects).toBeGreaterThanOrEqual(0);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0);
    expect(metrics.customerCount).toBeGreaterThanOrEqual(0);
    expect(metrics.pipelineValue).toBeGreaterThanOrEqual(0);
  });

  test('run executes one control loop iteration', async () => {
    const result = await loop.run();

    expect(result.evaluatedAt).toBeDefined();
    expect(result.metrics).toBeDefined();
    expect(result.identifiedActions).toBeDefined();
    expect(result.selectionReason).toBeDefined();
    expect(result.authorizationResult).toBeDefined();

    if (result.selectedAction) {
      expect(result.selectedAction.actionType).toBeDefined();
      expect(result.selectedAction.reason).toBeDefined();
    }
  });

  test('run respects authorization — R3+ actions are not executed autonomously', async () => {
    const result = await loop.run();

    if (result.selectedAction && result.authorizationResult.mode === 'human_required') {
      expect(result.executed).toBe(false);
      expect(result.authorizationResult.authorized).toBe(false);
    }
  });
});
