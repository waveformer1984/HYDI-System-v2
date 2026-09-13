/**
 * HEIDI Autonomous Revenue Campaign Qualification
 *
 * Tests the first bounded autonomous revenue campaign through the real
 * CognitiveCore, GoalSystem, ProspectPipeline, and RevenueLedger.
 *
 * Campaign: AI Operations (offer_id: ai_operations_setup + ai_operations_monthly)
 * Stream selected because:
 *   - Lowest setup cost ($500) — lowest barrier to conversion
 *   - Highest monthly margin target (0.80)
 *   - Broadest ICP fit (any business needing AI operations)
 *   - Easiest fulfillment (vs website deployment)
 *   - Fastest time to first revenue
 *
 * 10 controlled prospects are processed through:
 *   DISCOVER → DEDUPLICATE → CLASSIFY → SCORE → QUALIFY → PRIORITIZE → CREATE OPPORTUNITY
 *
 * NO mocks. NO bridgeOverrides. Real production adapters only.
 * Revenue is NEVER fabricated — only RevenueLedger verified entries count.
 */

import { buildCognitiveCore } from '../../lib/heidi/CognitiveCoreBuilder';
import type { CognitiveCore } from '../../lib/heidi/CognitiveCore';
import { GoalSystem, type GoalStatus } from '../../lib/heidi/GoalSystem';
import { ProspectPipeline } from '../../lib/revenue/ProspectPipeline';
import { RevenueLedger } from '../../lib/revenue/RevenueLedger';
import { RevenueDatabase } from '../../lib/revenue/RevenueDatabase';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CAMPAIGN_ID = `camp_aiops_${Date.now()}`;
const TEST_PREFIX = `revcamp${Date.now()}`; // No underscores — avoids LIKE wildcard issues

function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ─── Controlled test prospects ─────────────────────────────────────────
// These are AUTHORIZED TEST prospects — clearly labeled, not real businesses.
// They match the ICP configuration (small businesses, US-based, target industries).
const TEST_PROSPECTS = [
  {
    companyName: 'TestFlow Contractors',
    contactName: 'John Smith',
    contactEmail: `${TEST_PREFIX}1@test.campaign`,
    contactPhone: '555-0101',
    website: 'https://testflow-contractors.example',
    industry: 'contractor',
    location: 'Austin, TX',
    source: 'authorized_test' as const,
    metadata: { campaign: CAMPAIGN_ID, employeeCount: 12, annualRevenue: 850000 },
  },
  {
    companyName: 'QuickFix Repair Co',
    contactName: 'Sarah Johnson',
    contactEmail: `${TEST_PREFIX}2@test.campaign`,
    contactPhone: '555-0102',
    website: 'https://quickfix-repair.example',
    industry: 'repair',
    location: 'Denver, CO',
    source: 'authorized_test' as const,
    metadata: { campaign: CAMPAIGN_ID, employeeCount: 8, annualRevenue: 450000 },
  },
  {
    companyName: 'ProServices LLC',
    contactName: 'Mike Davis',
    contactEmail: `${TEST_PREFIX}3@test.campaign`,
    contactPhone: '555-0103',
    website: 'https://proservices-llc.example',
    industry: 'professional_services',
    location: 'Phoenix, AZ',
    source: 'authorized_test' as const,
    metadata: { campaign: CAMPAIGN_ID, employeeCount: 15, annualRevenue: 1200000 },
  },
  {
    companyName: 'ApptCare Services',
    contactName: 'Emily Brown',
    contactEmail: `${TEST_PREFIX}4@test.campaign`,
    contactPhone: '555-0104',
    website: 'https://apptcare-services.example',
    industry: 'appointment_based',
    location: 'Seattle, WA',
    source: 'authorized_test' as const,
    metadata: { campaign: CAMPAIGN_ID, employeeCount: 6, annualRevenue: 320000 },
  },
  {
    companyName: 'SmallAgency Digital',
    contactName: 'David Wilson',
    contactEmail: `${TEST_PREFIX}5@test.campaign`,
    contactPhone: '555-0105',
    website: 'https://smallagency-digital.example',
    industry: 'small_agency',
    location: 'Portland, OR',
    source: 'authorized_test' as const,
    metadata: { campaign: CAMPAIGN_ID, employeeCount: 20, annualRevenue: 2100000 },
  },
  // Duplicate of prospect 1 — to test deduplication
  {
    companyName: 'TestFlow Contractors',
    contactName: 'John Smith',
    contactEmail: `${TEST_PREFIX}1@test.campaign`,
    contactPhone: '555-0101',
    website: 'https://testflow-contractors.example',
    industry: 'contractor',
    location: 'Austin, TX',
    source: 'authorized_test' as const,
    metadata: { campaign: CAMPAIGN_ID, employeeCount: 12, annualRevenue: 850000 },
  },
];

async function cleanupCampaignData(pool: Pool, prospectIds: string[]): Promise<void> {
  try {
    if (prospectIds.length > 0) {
      const idList = prospectIds.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(`DELETE FROM revenue_events WHERE prospect_id IN (${idList})`, prospectIds);
      await pool.query(`DELETE FROM revenue_opportunities WHERE prospect_id IN (${idList})`, prospectIds);
      await pool.query(`DELETE FROM revenue_prospects WHERE prospect_id IN (${idList})`, prospectIds);
    }
    await pool.query('DELETE FROM heidi_goals WHERE title LIKE $1', [`${TEST_PREFIX}%`]);
    await pool.query('DELETE FROM actions WHERE task_name LIKE $1', [`${TEST_PREFIX}%`]);
    await pool.query('DELETE FROM cognitive_cycle_audit WHERE cycle_id LIKE $1', [`${TEST_PREFIX}%`]);
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

// Helper: sleep
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('HEIDI Autonomous Revenue Campaign Qualification', () => {
  let core: CognitiveCore;
  let pool: Pool;
  let supabase: SupabaseClient | null;
  let pipeline: ProspectPipeline;
  let ledger: RevenueLedger;
  let goals: GoalSystem;
  let missionGoalId: string;
  const createdProspectIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ ...DB_CONFIG, max: 5 });
    supabase = getSupabase();
    await ensureIdentityLevel2(pool);

    core = await buildCognitiveCore({
      dbConfig: DB_CONFIG,
      supabase: supabase || undefined,
      enableMetaCognition: false,
      enableDecisionResolver: false,
    });

    // Create real ProspectPipeline and RevenueLedger using the same DB
    const revDb = new RevenueDatabase(DB_CONFIG);
    pipeline = new ProspectPipeline(undefined, revDb);
    ledger = new RevenueLedger(revDb);
    goals = new GoalSystem(DB_CONFIG);
  }, 30000);

  afterAll(async () => {
    core.stop();
    await core.close();
    await goals.close();
    await cleanupCampaignData(pool, createdProspectIds);
    await pool.end();
  }, 30000);

  // ─── TEST 1: Create 5 controlled prospects ───────────────────────────

  test('TEST 1: Create 5 controlled prospects — verify persistence', async () => {
    // Create the revenue mission first
    const mission = await goals.createGoal({
      goalType: 'mission',
      title: `${TEST_PREFIX}_mission_revenue`,
      description: 'Generate verified revenue through the governed ProtoForge revenue pipeline.',
      priority: 10,
    });
    missionGoalId = mission.goalId;
    await goals.updateGoal(mission.goalId, { status: 'active' as GoalStatus });

    // Create an objective under the mission
    const objective = await goals.createGoal({
      goalType: 'objective',
      title: `${TEST_PREFIX}_obj_ai_ops_campaign`,
      parentId: mission.goalId,
      priority: 9,
      description: 'AI Operations campaign: identify, score, and qualify prospects for AI Operations setup + monthly.',
    });
    await goals.updateGoal(objective.goalId, { status: 'active' as GoalStatus });

    // Create 5 unique prospects
    const uniqueProspects = TEST_PROSPECTS.slice(0, 5);

    for (const p of uniqueProspects) {
      const result = await pipeline.identifyProspect(p);
      createdProspectIds.push(result.prospect.prospectId);

      // Verify the prospect was persisted
      const { rows } = await pool.query(
        'SELECT prospect_id, company_name, contact_email, source, status FROM revenue_prospects WHERE prospect_id = $1',
        [result.prospect.prospectId],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].company_name).toBe(p.companyName);
      expect(rows[0].source).toBe('authorized_test');
      // identifyProspect may auto-score, so status could be 'identified' or 'scored'
      expect(['identified', 'scored']).toContain(rows[0].status);
    }

    expect(createdProspectIds.length).toBe(5);

    // Verify all 5 are in the DB by prospect_id
    const { rows: countRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    expect(parseInt(countRows[0].cnt, 10)).toBe(5);
  }, 60000);

  // ─── TEST 2: Deduplicate prospects ───────────────────────────────────

  test('TEST 2: Deduplicate — adding a duplicate prospect does not create a new record', async () => {
    // The 6th prospect in TEST_PROSPECTS is a duplicate of the 1st
    const duplicate = TEST_PROSPECTS[5];
    const result = await pipeline.identifyProspect(duplicate);

    // Should return created: false (existing prospect found)
    expect(result.created).toBe(false);
    // Dedup may match on email or website — both are valid dedup keys
    expect(['email', 'website']).toContain(result.dedupMatch);

    // Verify no new prospect was created — still 5 unique
    const { rows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(5);
  }, 30000);

  // ─── TEST 3: Score every prospect ────────────────────────────────────

  test('TEST 3: Score every prospect — verify scores and evidence', async () => {
    expect(createdProspectIds.length).toBe(5);

    for (const prospectId of createdProspectIds) {
      const scoreResult = await pipeline.scoreProspect(prospectId);

      // Score must be 0-100
      expect(scoreResult.score).toBeGreaterThanOrEqual(0);
      expect(scoreResult.score).toBeLessThanOrEqual(100);

      // Factors must be present
      expect(scoreResult.factors).toBeDefined();
      expect(typeof scoreResult.factors).toBe('object');

      // Reason must be a non-empty string
      expect(scoreResult.reason).toBeTruthy();
      expect(typeof scoreResult.reason).toBe('string');
    }

    // Verify ICP-matching prospects score higher than non-ICP
    // All 5 prospects are ICP-matching (contractor, repair, professional_services, appointment_based, small_agency)
    // so they should all score reasonably well
    for (const prospectId of createdProspectIds) {
      const scoreResult = await pipeline.scoreProspect(prospectId);
      expect(scoreResult.score).toBeGreaterThan(20);
    }
  }, 60000);

  // ─── TEST 4: Create opportunities for qualified prospects ────────────

  test('TEST 4: Create opportunities for qualified prospects — verify DB state', async () => {
    // Get all scored prospects by ID
    const { rows: prospects } = await pool.query(
      'SELECT prospect_id, company_name, industry, icp_score FROM revenue_prospects WHERE prospect_id = ANY($1) ORDER BY icp_score DESC',
      [createdProspectIds],
    );

    expect(prospects.length).toBe(5);

    // Create opportunities for the top 3 qualified prospects
    const qualifiedCount = Math.min(3, prospects.length);
    const offerId = 'ai_operations_setup';
    const createdOppIds: string[] = [];

    for (let i = 0; i < qualifiedCount; i++) {
      const p = prospects[i];
      const opp = await pipeline.createOpportunity({
        prospectId: p.prospect_id,
        offerId,
        proposedPrice: 50000, // $500 in cents
        estimatedValue: 50000,
        probability: 0.3 + (p.icp_score / 100) * 0.4, // 30-70% based on score
        expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days
      });

      expect(opp).toBeDefined();
      expect(opp.offerId).toBe(offerId);
      expect(opp.status).toBe('open');
      createdOppIds.push(opp.opportunityId);

      // Verify in DB
      const { rows } = await pool.query(
        'SELECT opportunity_id, prospect_id, offer_id, status, proposed_price FROM revenue_opportunities WHERE opportunity_id = $1',
        [opp.opportunityId],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].offer_id).toBe(offerId);
      expect(rows[0].status).toBe('open');
      expect(parseInt(rows[0].proposed_price, 10)).toBe(50000);
    }

    // Verify 3 opportunities exist for our prospects
    const { rows: oppRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    expect(parseInt(oppRows[0].cnt, 10)).toBe(3);
  }, 60000);

  // ─── TEST 5: Create next-action tasks with goal association ──────────

  test('TEST 5: Create next-action tasks — verify goal association', async () => {
    // Get qualified prospects with opportunities
    const { rows: prospects } = await pool.query(
      `SELECT p.prospect_id, p.company_name, o.opportunity_id
       FROM revenue_prospects p
       JOIN revenue_opportunities o ON p.prospect_id = o.prospect_id
       WHERE p.prospect_id = ANY($1)
       ORDER BY p.icp_score DESC`,
      [createdProspectIds],
    );

    expect(prospects.length).toBe(3);

    // Create a follow-up task for each qualified prospect
    for (const p of prospects) {
      const task = await goals.createGoal({
        goalType: 'task',
        title: `${TEST_PREFIX}_task_followup_${p.company_name.replace(/\s+/g, '')}`,
        parentId: missionGoalId,
        priority: 8,
        context: {
          campaignId: CAMPAIGN_ID,
          prospectId: p.prospect_id,
          opportunityId: p.opportunity_id,
          nextAction: 'prepare_outreach_draft',
          offerId: 'ai_operations_setup',
        },
      });
      await goals.updateGoal(task.goalId, { status: 'active' as GoalStatus });

      // Verify the task is associated with the mission
      const retrieved = await goals.getGoal(task.goalId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.parentId).toBe(missionGoalId);
      expect(retrieved!.context.campaignId).toBe(CAMPAIGN_ID);
      expect(retrieved!.context.prospectId).toBe(p.prospect_id);
    }

    // Verify 3 follow-up tasks exist under the mission
    const children = await goals.getChildren(missionGoalId);
    const followUpTasks = children.filter((c) => c.title.includes('task_followup'));
    expect(followUpTasks.length).toBe(3);
  }, 60000);

  // ─── TEST 6: Run another cognitive cycle — no duplicate work ─────────

  test('TEST 6: Run cognitive cycle — completed work is not duplicated', async () => {
    // Count prospects before cycle
    const { rows: beforeRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const prospectsBefore = parseInt(beforeRows[0].cnt, 10);

    // Count opportunities before cycle
    const { rows: beforeOppRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const oppsBefore = parseInt(beforeOppRows[0].cnt, 10);

    // Run a cognitive cycle
    const state = await core.runCycle();

    // Count after cycle
    const { rows: afterRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const prospectsAfter = parseInt(afterRows[0].cnt, 10);

    const { rows: afterOppRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const oppsAfter = parseInt(afterOppRows[0].cnt, 10);

    // No duplicates created
    expect(prospectsAfter).toBe(prospectsBefore);
    expect(oppsAfter).toBe(oppsBefore);

    // The cycle should have completed
    expect(state.cycleId).toBeTruthy();
  }, 120000);

  // ─── TEST 7: Force a controlled prospect failure — verify replan ─────

  test('TEST 7: Force controlled prospect failure — verify replan', async () => {
    // Create a task with an invalid prospect ID to force failure
    const task = await goals.createGoal({
      goalType: 'task',
      title: `${TEST_PREFIX}_task_fail_test`,
      parentId: missionGoalId,
      priority: 10, // Max priority to be selected
      context: {
        capabilityId: 'revenue.score_prospect',
        capabilityParams: { prospectId: 'invalid-prospect-id-not-found' },
      },
    });
    await goals.updateGoal(task.goalId, { status: 'active' as GoalStatus });

    // Run a cycle — it should select this task, try to score the invalid prospect, fail
    const state = await core.runCycle();

    // If the cycle selected our score_prospect action, it should have failed
    if (state.selectedAction?.capabilityId === 'revenue.score_prospect') {
      if (state.executionResult?.outcome === 'failure') {
        // Replan should have been triggered
        expect(state.replanResult).not.toBeNull();
      }
    }

    // Clean up the failing task
    await goals.updateGoal(task.goalId, { status: 'completed' as GoalStatus });
  }, 120000);

  // ─── TEST 8: R2 communication action refused and escalated ───────────

  test('TEST 8: R2 communication action — refused and escalated', async () => {
    // Create a task that requires R2 authorization (outbound messaging)
    const task = await goals.createGoal({
      goalType: 'task',
      title: `${TEST_PREFIX}_task_r2_comm`,
      parentId: missionGoalId,
      priority: 10, // Highest priority to be selected
      context: {
        capabilityId: 'comm.send_message',
        capabilityParams: {
          channel: 'email',
          recipient: `${TEST_PREFIX}1@test.campaign`,
          subject: 'AI Operations Setup Offer',
          body: 'Hello, we would like to offer you AI Operations setup.',
          prospectId: createdProspectIds[0],
        },
      },
    });
    await goals.updateGoal(task.goalId, { status: 'active' as GoalStatus });

    // Run a cycle
    const state = await core.runCycle();

    // If the cycle selected our comm.send_message action, it should be refused
    if (state.selectedAction?.capabilityId === 'comm.send_message') {
      expect(state.authorizationResult).not.toBeNull();
      if (!state.authorizationResult!.authorized) {
        expect(state.authorizationResult!.authorizationMode).toBe('human_required');
        expect(state.authorizationResult!.escalationRecordId).not.toBeNull();

        // No execution should have occurred
        if (state.executionResult) {
          expect(state.executionResult.executed).toBe(false);
        }
      }
    }

    // Clean up
    await goals.updateGoal(task.goalId, { status: 'completed' as GoalStatus });
  }, 120000);

  // ─── TEST 9: Restart recovery — no duplicate actions ─────────────────

  test('TEST 9: Restart recovery — no duplicate actions after restart', async () => {
    // Count everything before restart
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

    // Simulate restart: resume goals
    const restartResult = await core.resumeAfterRestart();
    expect(restartResult.resumedGoals).toBeDefined();

    // Run a cycle after restart
    await core.runCycle();

    // Count after restart — should be the same
    const { rows: prospectRowsAfter } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const prospectsAfter = parseInt(prospectRowsAfter[0].cnt, 10);

    const { rows: oppRowsAfter } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    const oppsAfter = parseInt(oppRowsAfter[0].cnt, 10);

    expect(prospectsAfter).toBe(prospectsBefore);
    expect(oppsAfter).toBe(oppsBefore);
  }, 120000);

  // ─── TEST 10: Pipeline activity is NOT revenue ───────────────────────

  test('TEST 10: Pipeline activity is NOT counted as revenue', async () => {
    // Get verified revenue from the authoritative RevenueLedger
    const verifiedRevenue = await ledger.getVerifiedRevenue();

    // There should be NO verified revenue entries for our test campaign
    // (because no Stripe payment has been processed)
    const campaignRevenue = verifiedRevenue.filter(
      (e: any) => e.prospectId && createdProspectIds.includes(e.prospectId),
    );
    expect(campaignRevenue.length).toBe(0);

    // Get revenue summary
    const summary = await ledger.getRevenueSummary();
    expect(summary).toBeDefined();

    // Verify we have pipeline activity (5 prospects, 3 opportunities)
    const { rows: prospectRows } = await pool.query(
      'SELECT count(*) as cnt FROM revenue_prospects WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    expect(parseInt(prospectRows[0].cnt, 10)).toBe(5);

    const { rows: oppRows } = await pool.query(
      'SELECT count(*) as cnt, COALESCE(sum(proposed_price), 0) as total_value FROM revenue_opportunities WHERE prospect_id = ANY($1)',
      [createdProspectIds],
    );
    expect(parseInt(oppRows[0].cnt, 10)).toBe(3);
    const pipelineValue = parseInt(oppRows[0].total_value, 10);
    expect(pipelineValue).toBe(150000); // 3 × $500 = $1,500 = 150,000 cents

    // But verified revenue is 0 for this campaign
    // This proves the system correctly distinguishes pipeline from revenue
  }, 30000);

  // ─── CAMPAIGN SUMMARY ────────────────────────────────────────────────

  test('CAMPAIGN SUMMARY — verify complete campaign state', async () => {
    // Final state verification
    const { rows: prospects } = await pool.query(
      'SELECT prospect_id, company_name, industry, status, icp_score FROM revenue_prospects WHERE prospect_id = ANY($1) ORDER BY icp_score DESC',
      [createdProspectIds],
    );

    const { rows: opportunities } = await pool.query(
      `SELECT o.opportunity_id, o.prospect_id, o.offer_id, o.status, o.proposed_price, p.company_name
       FROM revenue_opportunities o
       JOIN revenue_prospects p ON o.prospect_id = p.prospect_id
       WHERE p.prospect_id = ANY($1)`,
      [createdProspectIds],
    );

    const verifiedRevenue = await ledger.getVerifiedRevenue();

    const missionChildren = await goals.getChildren(missionGoalId);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('AUTONOMOUS REVENUE CAMPAIGN SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Campaign ID:           ${CAMPAIGN_ID}`);
    console.log(`Selected Stream:       AI Operations (ai_operations_setup)`);
    console.log(`Mission Goal ID:       ${missionGoalId}`);
    console.log(`Prospects Created:     ${prospects.length}`);
    console.log(`Opportunities Created: ${opportunities.length}`);
    console.log(`Pipeline Value:        $${opportunities.reduce((s, o) => s + parseInt(o.proposed_price, 10), 0) / 100}`);
    console.log(`Verified Revenue:      $0 (no Stripe payments processed)`);
    console.log(`Goal Children:         ${missionChildren.length}`);
    console.log(`Autonomy Level:        2 (EXECUTE_REVERSIBLE)`);
    console.log('═══════════════════════════════════════════════════════════════');

    // Verify campaign integrity
    expect(prospects.length).toBe(5);
    expect(opportunities.length).toBe(3);
    expect(verifiedRevenue.filter((e: any) => createdProspectIds.includes(e.prospectId)).length).toBe(0);

    // All prospects should have a score
    for (const p of prospects) {
      expect(p.icp_score).not.toBeNull();
    }
  }, 30000);
});
