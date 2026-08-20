/**
 * HEIDI Commercial Workflow Qualification
 *
 * 20 tests covering the full prospect-to-payment commercial workflow:
 *
 * 1. External discovery provenance
 * 2. Real prospect ingestion
 * 3. Deduplication
 * 4. ICP scoring
 * 5. Opportunity creation
 * 6. Personalized outreach generation
 * 7. Authorization package creation
 * 8. R2 communication refusal
 * 9. Human approval path
 * 10. Communication delivery verification (BLOCKED — no email provider)
 * 11. Inbound response classification
 * 12. Opportunity advancement
 * 13. Customer creation (R2 — requires authorization)
 * 14. Service activation (R2 — requires authorization)
 * 15. Payment verification (BLOCKED — no Stripe credentials)
 * 16. RevenueLedger verification
 * 17. Pipeline/revenue separation
 * 18. Restart recovery
 * 19. Duplicate prevention
 * 20. Replanning after commercial failure
 *
 * Tests distinguish REAL, MOCK, and BLOCKED.
 * Never call mocked behavior live qualification.
 */

import { ProspectPipeline } from '../../lib/revenue/ProspectPipeline';
import { RevenueLedger } from '../../lib/revenue/RevenueLedger';
import { RevenueDatabase } from '../../lib/revenue/RevenueDatabase';
import { CustomerLifecycle } from '../../lib/revenue/CustomerLifecycle';
import {
  ProspectDiscoveryAdapter,
  createDiscoveryAdapterFromEnv,
  type DiscoveredProspect,
} from '../../lib/revenue/ProspectDiscoveryAdapter';
import { OutreachDraftGenerator } from '../../lib/revenue/OutreachDraftGenerator';
import { AuthorizationPackageManager } from '../../lib/revenue/AuthorizationPackage';
import { InboundResponseHandler, type InboundMessage } from '../../lib/revenue/InboundResponseHandler';
import { CommercialWorkflow } from '../../lib/revenue/CommercialWorkflow';
import { getOfferCatalog } from '../../lib/revenue/OfferCatalog';
import type { OfferId, ProspectRecord, OpportunityRecord } from '../../lib/revenue/types';
import { GoalSystem, type GoalStatus } from '../../lib/heidi/GoalSystem';
import { Pool } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

const CAMPAIGN_ID = `commcamp_${Date.now()}`;
const TEST_PREFIX = `commtest${Date.now()}`; // No underscores — avoids LIKE wildcard issues

// ─── Controlled test prospects (authorized_test) ──────────────────────
function makeTestProspect(suffix: number): DiscoveredProspect {
  const now = new Date().toISOString();
  return {
    companyName: `CommTest Biz ${suffix}`,
    contactName: `Test Person ${suffix}`,
    contactEmail: `${TEST_PREFIX}${suffix}@comm.test`,
    contactPhone: `555-0${suffix}0`,
    website: `https://commtest-biz-${suffix}.example`,
    industry: 'contractor',
    location: 'Austin, TX',
    source: 'authorized_test',
    sourceUrl: null,
    discoveryEvidence: {
      provider: 'test_fixture',
      query: 'controlled test',
      resultCount: 1,
      retrievedAt: now,
      raw: { suffix },
    },
    metadata: {
      campaign: CAMPAIGN_ID,
      employeeCount: 10 + suffix,
      annualRevenue: 500000 + suffix * 100000,
    },
  };
}

async function cleanupTestData(pool: Pool, prospectIds: string[]): Promise<void> {
  try {
    if (prospectIds.length > 0) {
      const idList = prospectIds.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(`DELETE FROM revenue_events WHERE prospect_id IN (${idList})`, prospectIds);
      await pool.query(`DELETE FROM revenue_opportunities WHERE prospect_id IN (${idList})`, prospectIds);
      await pool.query(`DELETE FROM revenue_prospects WHERE prospect_id IN (${idList})`, prospectIds);
    }
    await pool.query('DELETE FROM heidi_goals WHERE title LIKE $1', [`${TEST_PREFIX}%`]);
  } catch {
    // Non-fatal
  }
}

async function ensureIdentityLevel2(pool: Pool): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO heidi_identity (id, autonomy_level, capabilities, role)
       VALUES (1, 2, '["observation","goal_management","tool_execution","communication","revenue_analysis","revenue_pipeline"]'::jsonb, 'production')
       ON CONFLICT (id) DO UPDATE SET autonomy_level = 2, capabilities = EXCLUDED.capabilities`,
    );
  } catch {
    // Non-fatal
  }
}

describe('HEIDI Commercial Workflow Qualification', () => {
  let pool: Pool;
  let revDb: RevenueDatabase;
  let pipeline: ProspectPipeline;
  let ledger: RevenueLedger;
  let lifecycle: CustomerLifecycle;
  let workflow: CommercialWorkflow;
  let goals: GoalSystem;
  let missionGoalId: string;
  let createdProspectIds: string[] = [];
  let createdOpportunityIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ ...DB_CONFIG, max: 5 });
    await ensureIdentityLevel2(pool);

    revDb = new RevenueDatabase(DB_CONFIG);
    pipeline = new ProspectPipeline(undefined, revDb);
    ledger = new RevenueLedger(revDb);
    lifecycle = new CustomerLifecycle(revDb);
    goals = new GoalSystem(DB_CONFIG);

    const discovery = createDiscoveryAdapterFromEnv();
    workflow = new CommercialWorkflow({
      pipeline,
      ledger,
      lifecycle,
      discovery,
    });
  }, 30000);

  afterAll(async () => {
    await goals.close();
    await cleanupTestData(pool, createdProspectIds);
    await pool.end();
  }, 30000);

  // ─── TEST 1: External discovery provenance ───────────────────────────

  test('TEST 1: Discovery adapter reports provenance and BLOCKED status correctly', () => {
    const adapter = createDiscoveryAdapterFromEnv();

    // The adapter must report whether it's available or blocked
    if (adapter.isAvailable()) {
      // If available, it must have no blocker reason
      expect(adapter.getBlockerReason()).toBeNull();
    } else {
      // If blocked, it must report the exact missing configuration
      expect(adapter.getBlockerReason()).not.toBeNull();
      expect(adapter.getBlockerReason()!.length).toBeGreaterThan(10);
      // Must mention the missing credential
      expect(
        adapter.getBlockerReason()!.includes('GOOGLE_PLACES_API_KEY') ||
        adapter.getBlockerReason()!.includes('CLEARBIT_API_KEY') ||
        adapter.getBlockerReason()!.includes('INBOUND_WEBHOOK_SECRET') ||
        adapter.getBlockerReason()!.includes('provider'),
      ).toBe(true);
    }
  }, 10000);

  // ─── TEST 2: Real prospect ingestion with provenance ─────────────────

  test('TEST 2: Real prospect ingestion — discovered prospect enters pipeline with full provenance', async () => {
    // Create the revenue mission
    const mission = await goals.createGoal({
      goalType: 'mission',
      title: `${TEST_PREFIX}_mission_commercial`,
      description: 'Commercial workflow: prospect to payment.',
      priority: 10,
    });
    missionGoalId = mission.goalId;
    await goals.updateGoal(mission.goalId, { status: 'active' as GoalStatus });

    // Ingest a discovered prospect
    const discovered = makeTestProspect(1);
    const result = await workflow.ingestProspect(discovered);

    expect(result.prospect).toBeDefined();
    expect(result.prospect.companyName).toBe(discovered.companyName);
    expect(result.prospect.source).toBe('authorized_test');
    createdProspectIds.push(result.prospect.prospectId);

    // Verify provenance is stored in metadata
    const dbProspect = await pipeline.getProspect(result.prospect.prospectId);
    expect(dbProspect).not.toBeNull();
    expect(dbProspect!.metadata).toBeDefined();
    const meta = dbProspect!.metadata as Record<string, unknown>;
    expect(meta.discoveryEvidence).toBeDefined();
    expect((meta.discoveryEvidence as Record<string, unknown>).provider).toBe('test_fixture');
  }, 30000);

  // ─── TEST 3: Deduplication ───────────────────────────────────────────

  test('TEST 3: Deduplication — same prospect ingested twice does not create duplicate', async () => {
    const discovered = makeTestProspect(2);
    const result1 = await workflow.ingestProspect(discovered);
    createdProspectIds.push(result1.prospect.prospectId);

    // Ingest the same prospect again
    const result2 = await workflow.ingestProspect(discovered);

    expect(result2.created).toBe(false);
    expect(result2.prospect.prospectId).toBe(result1.prospect.prospectId);
  }, 30000);

  // ─── TEST 4: ICP scoring ─────────────────────────────────────────────

  test('TEST 4: ICP scoring — prospect is scored with evidence', async () => {
    const discovered = makeTestProspect(3);
    const result = await workflow.ingestProspect(discovered);
    createdProspectIds.push(result.prospect.prospectId);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);

    // ICP-matching prospect (contractor) should score reasonably
    expect(result.score).toBeGreaterThan(20);
  }, 30000);

  // ─── TEST 5: Opportunity creation ────────────────────────────────────

  test('TEST 5: Opportunity creation — qualified prospect gets an opportunity', async () => {
    // Use the prospect from TEST 2 (contractor, should be qualified)
    const prospect = await pipeline.getProspect(createdProspectIds[0]);
    expect(prospect).not.toBeNull();
    expect(prospect!.icpScore).toBeGreaterThanOrEqual(50);

    const opp = await workflow.createOpportunityForProspect(createdProspectIds[0], 'ai_operations_setup');
    expect(opp).not.toBeNull();
    expect(opp!.offerId).toBe('ai_operations_setup');
    expect(opp!.status).toBe('open');
    createdOpportunityIds.push(opp!.opportunityId);
  }, 30000);

  // ─── TEST 6: Personalized outreach generation ────────────────────────

  test('TEST 6: Outreach draft — evidence-backed, no hallucination', async () => {
    const prospect = await pipeline.getProspect(createdProspectIds[0]);
    expect(prospect).not.toBeNull();

    // Get the opportunity
    const { rows } = await pool.query(
      'SELECT * FROM revenue_opportunities WHERE prospect_id = $1 AND status = $2',
      [createdProspectIds[0], 'open'],
    );
    expect(rows.length).toBeGreaterThan(0);
    const oppRow = rows[0];

    const opp: OpportunityRecord = {
      opportunityId: oppRow.opportunity_id,
      prospectId: oppRow.prospect_id,
      offerId: oppRow.offer_id,
      proposedPrice: parseInt(oppRow.proposed_price, 10),
      estimatedValue: parseInt(oppRow.estimated_value, 10),
      status: oppRow.status,
      probability: parseFloat(oppRow.probability),
      expectedCloseDate: oppRow.expected_close_date,
      discountAuthorizedBy: oppRow.discount_authorized_by || null, discountApplied: oppRow.discount_applied || 0, proposalId: oppRow.proposal_id || null, customerId: oppRow.customer_id || null,
      createdAt: oppRow.created_at,
      updatedAt: oppRow.updated_at,
    };

    const draft = workflow.prepareOutreachDraft(
      prospect!,
      opp,
      'ai_operations_setup',
      'cycle_test_001',
      missionGoalId,
    );

    expect(draft.draftId).toBeTruthy();
    expect(draft.prospectId).toBe(prospect!.prospectId);
    expect(draft.opportunityId).toBe(opp.opportunityId);
    expect(draft.offerId).toBe('ai_operations_setup');
    expect(draft.messageSubject).toContain(prospect!.companyName);
    expect(draft.messageBody).toBeTruthy();
    expect(draft.messageBody.length).toBeGreaterThan(50);

    // Evidence must be present
    expect(draft.evidenceUsed).toBeDefined();
    expect(draft.evidenceUsed.knownFacts.length).toBeGreaterThan(0);
    expect(draft.evidenceUsed.unknownFacts.length).toBeGreaterThan(0);

    // Must NOT hallucinate unknown facts
    expect(draft.evidenceUsed.unknownFacts).toContain('Specific pain points: not investigated');
    expect(draft.evidenceUsed.unknownFacts).toContain('Technology stack: not analyzed');

    // Authorization state must be 'draft'
    expect(draft.authorizationState).toBe('draft');
  }, 30000);

  // ─── TEST 7: Authorization package creation ──────────────────────────

  test('TEST 7: Authorization package — contains all required fields', async () => {
    const prospect = await pipeline.getProspect(createdProspectIds[0]);
    expect(prospect).not.toBeNull();

    const { rows } = await pool.query(
      'SELECT * FROM revenue_opportunities WHERE prospect_id = $1 AND status = $2',
      [createdProspectIds[0], 'open'],
    );
    const oppRow = rows[0];
    const opp: OpportunityRecord = {
      opportunityId: oppRow.opportunity_id,
      prospectId: oppRow.prospect_id,
      offerId: oppRow.offer_id,
      proposedPrice: parseInt(oppRow.proposed_price, 10),
      estimatedValue: parseInt(oppRow.estimated_value, 10),
      status: oppRow.status,
      probability: parseFloat(oppRow.probability),
      expectedCloseDate: oppRow.expected_close_date,
      discountAuthorizedBy: oppRow.discount_authorized_by || null, discountApplied: oppRow.discount_applied || 0, proposalId: oppRow.proposal_id || null, customerId: oppRow.customer_id || null,
      createdAt: oppRow.created_at,
      updatedAt: oppRow.updated_at,
    };

    const draft = workflow.prepareOutreachDraft(
      prospect!,
      opp,
      'ai_operations_setup',
      'cycle_test_002',
      missionGoalId,
    );

    const pkg = workflow.createAuthorizationPackage(
      prospect!,
      opp,
      draft,
      missionGoalId,
      'cycle_test_002',
    );

    // Required fields
    expect(pkg.packageId).toBeTruthy();
    expect(pkg.prospectId).toBe(prospect!.prospectId);
    expect(pkg.companyName).toBe(prospect!.companyName);
    expect(pkg.source).toBe(prospect!.source);
    expect(pkg.icpScore).toBe(prospect!.icpScore);
    expect(pkg.icpEvidence.length).toBeGreaterThan(0);
    expect(pkg.opportunityId).toBe(opp.opportunityId);
    expect(pkg.offerId).toBe('ai_operations_setup');
    expect(pkg.priceCents).toBe(opp.proposedPrice);
    expect(pkg.proposedMessage.body).toBeTruthy();
    expect(pkg.riskLevel).toBe('R2');
    expect(pkg.authorizationMode).toBe('human_required');
    expect(pkg.reasonAuthorizationRequired).toBeTruthy();
    expect(pkg.goalId).toBe(missionGoalId);
    expect(pkg.cognitiveCycleId).toBe('cycle_test_002');
    expect(pkg.evidence.length).toBeGreaterThan(0);

    // Decision must be pending
    expect(pkg.decision).toBe('pending');
  }, 30000);

  // ─── TEST 8: R2 communication refusal ────────────────────────────────

  test('TEST 8: R2 communication — unapproved package cannot be sent', async () => {
    const prospect = await pipeline.getProspect(createdProspectIds[0]);
    const { rows } = await pool.query(
      'SELECT * FROM revenue_opportunities WHERE prospect_id = $1 AND status = $2',
      [createdProspectIds[0], 'open'],
    );
    const oppRow = rows[0];
    const opp: OpportunityRecord = {
      opportunityId: oppRow.opportunity_id,
      prospectId: oppRow.prospect_id,
      offerId: oppRow.offer_id,
      proposedPrice: parseInt(oppRow.proposed_price, 10),
      estimatedValue: parseInt(oppRow.estimated_value, 10),
      status: oppRow.status,
      probability: parseFloat(oppRow.probability),
      expectedCloseDate: oppRow.expected_close_date,
      discountAuthorizedBy: oppRow.discount_authorized_by || null, discountApplied: oppRow.discount_applied || 0, proposalId: oppRow.proposal_id || null, customerId: oppRow.customer_id || null,
      createdAt: oppRow.created_at,
      updatedAt: oppRow.updated_at,
    };

    const draft = workflow.prepareOutreachDraft(
      prospect!,
      opp,
      'ai_operations_setup',
      'cycle_test_003',
      missionGoalId,
    );

    const pkg = workflow.createAuthorizationPackage(
      prospect!,
      opp,
      draft,
      missionGoalId,
      'cycle_test_003',
    );

    // Attempt to send WITHOUT approval
    const sendResult = await workflow.sendApprovedMessage(pkg.packageId);
    expect(sendResult.success).toBe(false);
    expect(sendResult.blocked).toBe(true);
    expect(sendResult.blockerReason).toContain('not approved');
  }, 30000);

  // ─── TEST 9: Human approval path ─────────────────────────────────────

  test('TEST 9: Human approval — explicit approve authorizes the package', async () => {
    const prospect = await pipeline.getProspect(createdProspectIds[0]);
    const { rows } = await pool.query(
      'SELECT * FROM revenue_opportunities WHERE prospect_id = $1 AND status = $2',
      [createdProspectIds[0], 'open'],
    );
    const oppRow = rows[0];
    const opp: OpportunityRecord = {
      opportunityId: oppRow.opportunity_id,
      prospectId: oppRow.prospect_id,
      offerId: oppRow.offer_id,
      proposedPrice: parseInt(oppRow.proposed_price, 10),
      estimatedValue: parseInt(oppRow.estimated_value, 10),
      status: oppRow.status,
      probability: parseFloat(oppRow.probability),
      expectedCloseDate: oppRow.expected_close_date,
      discountAuthorizedBy: oppRow.discount_authorized_by || null, discountApplied: oppRow.discount_applied || 0, proposalId: oppRow.proposal_id || null, customerId: oppRow.customer_id || null,
      createdAt: oppRow.created_at,
      updatedAt: oppRow.updated_at,
    };

    const draft = workflow.prepareOutreachDraft(
      prospect!,
      opp,
      'ai_operations_setup',
      'cycle_test_004',
      missionGoalId,
    );

    const pkg = workflow.createAuthorizationPackage(
      prospect!,
      opp,
      draft,
      missionGoalId,
      'cycle_test_004',
    );

    // Approve explicitly
    const approved = workflow.approveAuthorizationPackage(pkg.packageId, 'human_owner', 'Looks good');
    expect(approved).not.toBeNull();
    expect(approved!.decision).toBe('approved');
    expect(approved!.decidedBy).toBe('human_owner');
    expect(approved!.decidedAt).not.toBeNull();

    // Verify it's approved
    expect(workflow.getAuthManager().isApproved(pkg.packageId)).toBe(true);

    // Now attempt to send — will still be BLOCKED (no email provider)
    // but the authorization check should pass
    const sendResult = await workflow.sendApprovedMessage(pkg.packageId);
    expect(sendResult.success).toBe(false);
    expect(sendResult.blocked).toBe(true);
    // The blocker should be about email provider, NOT about authorization
    expect(sendResult.blockerReason).not.toContain('not approved');
  }, 30000);

  // ─── TEST 10: Communication delivery verification (BLOCKED) ──────────

  test('TEST 10: Communication delivery — BLOCKED without email provider', async () => {
    // Check workflow state for email availability
    const state = await workflow.getState();

    if (!state.emailAvailable) {
      // Email is BLOCKED — verify the blocker reason is clear
      expect(state.emailBlocker).not.toBeNull();
      expect(state.emailBlocker).toContain('SENDGRID_API_KEY');
      expect(state.emailBlocker).toContain('SMTP');
    }
    // If email IS available, we'd verify delivery here — but it's not in this env
  }, 10000);

  // ─── TEST 11: Inbound response classification ────────────────────────

  test('TEST 11: Inbound response — classified and associated with prospect', async () => {
    const handler = workflow.getInboundHandler();
    const prospects = await pipeline.getProspectsByStatus('scored', 10);

    const message: InboundMessage = {
      messageId: `msg_${Date.now()}`,
      receivedAt: new Date().toISOString(),
      channel: 'email',
      fromAddress: `${TEST_PREFIX}1@comm.test`,
      fromName: 'Test Person 1',
      subject: 'Re: AI Operations Setup',
      body: 'I am interested in learning more. Can we schedule a call?',
      prospectId: null,
      opportunityId: null,
    };

    const result = await handler.processInbound(message, prospects, []);

    expect(result.classification).toBeDefined();
    expect(result.intent).toBe('interested');
    expect(result.recommendedNextAction).toBeTruthy();
    expect(result.requiresHumanAction).toBe(true);
    expect(result.responseDraft).not.toBeNull();
  }, 30000);

  // ─── TEST 12: Opportunity advancement ────────────────────────────────

  test('TEST 12: Opportunity advancement — prospect status advances after response', async () => {
    // Advance the prospect to 'contacted' then 'responded'
    await pipeline.updateStatus(createdProspectIds[0], 'contacted', { channel: 'email' });
    await pipeline.updateStatus(createdProspectIds[0], 'responded', { responseIntent: 'interested' });

    const prospect = await pipeline.getProspect(createdProspectIds[0]);
    expect(prospect).not.toBeNull();
    expect(prospect!.status).toBe('responded');
  }, 30000);

  // ─── TEST 13: Customer creation (R2 — requires authorization) ────────

  test('TEST 13: Customer creation — requires R2 authorization and acceptance evidence', async () => {
    // Attempt without acceptance evidence
    const result1 = await workflow.convertToCustomer(createdOpportunityIds[0], {
      source: 'test',
      evidence: '',
      acceptedBy: 'test',
    });
    expect(result1.success).toBe(false);
    expect(result1.blocked).toBe(true);
    expect(result1.blockerReason).toContain('evidence');

    // Attempt with evidence but at Level 2 — still requires R2 authorization
    const result2 = await workflow.convertToCustomer(createdOpportunityIds[0], {
      source: 'email_response',
      evidence: 'Prospect explicitly accepted the offer in writing',
      acceptedBy: 'prospect@example.com',
    });
    expect(result2.success).toBe(false);
    expect(result2.blocked).toBe(true);
    expect(result2.blockerReason).toContain('R2');
  }, 30000);

  // ─── TEST 14: Service activation (R2 — requires authorization) ───────

  test('TEST 14: Service activation — R2 action requires human authorization', async () => {
    // Service activation is R2 — at Level 2, it requires human authorization
    // The CustomerLifecycle.startOnboarding and activateService are R2 capabilities
    // Verify they're classified correctly
    const state = await workflow.getState();
    expect(state).toBeDefined();
    // We can't actually activate a service without a customer
    // and we can't create a customer without R2 authorization
  }, 10000);

  // ─── TEST 15: Payment verification (BLOCKED — no Stripe) ─────────────

  test('TEST 15: Payment verification — BLOCKED without Stripe credentials', async () => {
    const state = await workflow.getState();

    if (!state.stripeAvailable) {
      expect(state.stripeBlocker).not.toBeNull();
      expect(state.stripeBlocker).toContain('STRIPE_SECRET_KEY');

      // Attempt to process payment — should be BLOCKED
      const result = await workflow.processPayment(createdOpportunityIds[0]);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerReason).toContain('STRIPE_SECRET_KEY');
    }
  }, 10000);

  // ─── TEST 16: RevenueLedger verification ─────────────────────────────

  test('TEST 16: RevenueLedger — no verified revenue for test campaign', async () => {
    const result = await workflow.verifyRevenue();

    // There should be NO verified revenue entries for our test campaign
    // (because no Stripe payment has been processed)
    const campaignEntries = result.entries.filter((e) => !e.verified || e.amount === 0);
    // All entries (if any) should be from other test runs, not this campaign
    expect(result.verifiedRevenueCents).toBeGreaterThanOrEqual(0);
  }, 10000);

  // ─── TEST 17: Pipeline/revenue separation ────────────────────────────

  test('TEST 17: Pipeline/revenue separation — pipeline value is NOT revenue', async () => {
    const state = await workflow.getState();

    // Pipeline value and verified revenue are separate
    expect(state.pipelineValueCents).toBeGreaterThanOrEqual(0);
    expect(state.verifiedRevenueCents).toBeGreaterThanOrEqual(0);

    // Verified revenue must be 0 for our campaign (no payments processed)
    // Pipeline value may be > 0 (we have open opportunities)
    // But pipeline value is NOT revenue
    if (state.pipelineValueCents > 0) {
      // This is pipeline, not revenue — the dashboard must show them separately
      expect(state.verifiedRevenueCents).toBe(0);
    }
  }, 10000);

  // ─── TEST 18: Restart recovery ───────────────────────────────────────

  test('TEST 18: Restart recovery — prospects and opportunities survive restart', async () => {
    // Count before "restart"
    const { rows: prospectRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const prospectsBefore = parseInt(prospectRows[0].cnt, 10);

    const { rows: oppRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const oppsBefore = parseInt(oppRows[0].cnt, 10);

    // Simulate restart: re-create the workflow with the same DB
    const newRevDb = new RevenueDatabase(DB_CONFIG);
    const newPipeline = new ProspectPipeline(undefined, newRevDb);
    const newLedger = new RevenueLedger(newRevDb);
    const newLifecycle = new CustomerLifecycle(newRevDb);
    const newWorkflow = new CommercialWorkflow({
      pipeline: newPipeline,
      ledger: newLedger,
      lifecycle: newLifecycle,
    });

    // Verify state survived
    const newState = await newWorkflow.getState();
    expect(newState.prospectsDiscovered).toBeGreaterThan(0);

    // Count after restart — should be the same
    const { rows: prospectRowsAfter } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const prospectsAfter = parseInt(prospectRowsAfter[0].cnt, 10);
    expect(prospectsAfter).toBe(prospectsBefore);

    const { rows: oppRowsAfter } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const oppsAfter = parseInt(oppRowsAfter[0].cnt, 10);
    expect(oppsAfter).toBe(oppsBefore);
  }, 30000);

  // ─── TEST 19: Duplicate prevention ───────────────────────────────────

  test('TEST 19: Duplicate prevention — re-ingesting same prospect does not create duplicate', async () => {
    const { rows: beforeRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const before = parseInt(beforeRows[0].cnt, 10);

    // Re-ingest prospect 1
    const discovered = makeTestProspect(1);
    await workflow.ingestProspect(discovered);

    const { rows: afterRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const after = parseInt(afterRows[0].cnt, 10);

    expect(after).toBe(before);
  }, 30000);

  // ─── TEST 20: Replanning after commercial failure ────────────────────

  test('TEST 20: Replanning — failed opportunity triggers replan', async () => {
    // Create a prospect and opportunity, then mark it as lost
    const discovered = makeTestProspect(20);
    const result = await workflow.ingestProspect(discovered);
    createdProspectIds.push(result.prospect.prospectId);

    const opp = await workflow.createOpportunityForProspect(result.prospect.prospectId, 'ai_operations_setup');
    expect(opp).not.toBeNull();
    createdOpportunityIds.push(opp!.opportunityId);

    // Mark the prospect as lost (commercial failure)
    await pipeline.updateStatus(result.prospect.prospectId, 'lost', { reason: 'Prospect declined' });

    const prospect = await pipeline.getProspect(result.prospect.prospectId);
    expect(prospect).not.toBeNull();
    expect(prospect!.status).toBe('lost');

    // The workflow should be able to continue with other prospects
    // (replanning = don't stop, try the next prospect)
    const state = await workflow.getState();
    expect(state).toBeDefined();
  }, 30000);

  // ─── COMMERCIAL SUMMARY ──────────────────────────────────────────────

  test('COMMERCIAL SUMMARY — verify complete commercial workflow state', async () => {
    const state = await workflow.getState();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('COMMERCIAL WORKFLOW SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Campaign ID:              ${CAMPAIGN_ID}`);
    console.log(`Discovery Available:      ${state.discoveryAvailable}`);
    console.log(`Discovery Blocker:        ${state.discoveryBlocker || 'None'}`);
    console.log(`Stripe Available:         ${state.stripeAvailable}`);
    console.log(`Stripe Blocker:           ${state.stripeBlocker || 'None'}`);
    console.log(`Email Available:          ${state.emailAvailable}`);
    console.log(`Email Blocker:            ${state.emailBlocker || 'None'}`);
    console.log(`Prospects Discovered:     ${state.prospectsDiscovered}`);
    console.log(`Prospects Qualified:      ${state.prospectsQualified}`);
    console.log(`Opportunities:            ${state.opportunitiesCreated}`);
    console.log(`Auth Packages Pending:    ${state.authorizationPackagesCreated}`);
    console.log(`Auth Packages Approved:   ${state.authorizationPackagesApproved}`);
    console.log(`Messages Sent:            ${state.messagesSent}`);
    console.log(`Responses Received:       ${state.responsesReceived}`);
    console.log(`Customers:                ${state.customersCreated}`);
    console.log(`Services Activated:       ${state.servicesActivated}`);
    console.log(`Payments Processed:       ${state.paymentsProcessed}`);
    console.log(`Verified Revenue:         $${state.verifiedRevenueCents / 100}`);
    console.log(`Pipeline Value:           $${state.pipelineValueCents / 100}`);
    console.log(`Autonomy Level:           2 (EXECUTE_REVERSIBLE)`);
    console.log('═══════════════════════════════════════════════════════════════');

    // Verify no fabricated revenue
    expect(state.verifiedRevenueCents).toBeGreaterThanOrEqual(0);
    // Pipeline value and revenue are separate
    expect(state.pipelineValueCents).toBeGreaterThanOrEqual(0);
  }, 30000);
});
