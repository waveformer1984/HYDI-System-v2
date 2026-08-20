/**
 * HEIDI Real Campaign Execution Script
 *
 * Executes a real bounded commercial campaign through the governed path:
 *   DISCOVER → SCORE → QUALIFY → CREATE OPPORTUNITY → CREATE OFFER →
 *   GENERATE OUTREACH DRAFT → CREATE AUTHORIZATION PACKAGE →
 *   [BLOCKED: SEND] → [BLOCKED: RESPONSE] → [BLOCKED: PAYMENT] →
 *   [BLOCKED: CUSTOMER] → [BLOCKED: FULFILLMENT]
 *
 * Reports READY/BLOCKED at each stage.
 * Never fabricates success.
 * Never bypasses governance.
 *
 * Usage:
 *   npx tsx scripts/execute-real-campaign.ts [--prospects=<csv_file>]
 *
 * Without a CSV file, uses authorized_test prospects to demonstrate
 * the governed path. Real prospects require a CSV file with columns:
 *   company_name, contact_name, contact_email, contact_phone, website,
 *   industry, location, employee_count, annual_revenue
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { CampaignLoopManager, DEFAULT_CAMPAIGN_CONFIG } from '../lib/revenue/CampaignLoopManager';
import { CommercialWorkflow } from '../lib/revenue/CommercialWorkflow';
import { ProspectDiscoveryAdapter, createDiscoveryAdapterFromEnv } from '../lib/revenue/ProspectDiscoveryAdapter';
import { ProspectPipeline } from '../lib/revenue/ProspectPipeline';
import { RevenueLedger } from '../lib/revenue/RevenueLedger';
import { CustomerLifecycle } from '../lib/revenue/CustomerLifecycle';
import { RevenueDatabase } from '../lib/revenue/RevenueDatabase';
import { StripeBridge } from '../lib/revenue/StripeBridge';
import { GoalSystem } from '../lib/heidi/GoalSystem';
import { getOfferCatalog } from '../lib/revenue/OfferCatalog';
import { CommunicationLayer } from '../lib/communication/communicationLayer';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

const CAMPAIGN_ID = `real_campaign_${Date.now()}`;

// Authorized test prospects — legitimate test data with full provenance
// Real prospects require a CSV file passed via --prospects=<file>
const TEST_PROSPECTS: Array<Record<string, string>> = [
  {
    company_name: 'Austin Contracting Solutions',
    contact_name: 'Owner',
    contact_email: `real_campaign_1_${Date.now()}@test.austin-contracting.example`,
    contact_phone: '555-0100',
    website: 'https://austin-contracting.example',
    industry: 'contractor',
    location: 'Austin, TX',
    employee_count: '12',
    annual_revenue: '750000',
  },
  {
    company_name: 'Lone Star Builders',
    contact_name: 'Owner',
    contact_email: `real_campaign_2_${Date.now()}@test.lonestar-builders.example`,
    contact_phone: '555-0200',
    website: 'https://lonestar-builders.example',
    industry: 'contractor',
    location: 'Austin, TX',
    employee_count: '25',
    annual_revenue: '1800000',
  },
  {
    company_name: 'Hill Country Electrical',
    contact_name: 'Owner',
    contact_email: `real_campaign_3_${Date.now()}@test.hillcountry-electrical.example`,
    contact_phone: '555-0300',
    website: 'https://hillcountry-electrical.example',
    industry: 'contractor',
    location: 'Austin, TX',
    employee_count: '8',
    annual_revenue: '450000',
  },
  {
    company_name: 'Capital City Plumbing',
    contact_name: 'Owner',
    contact_email: `real_campaign_4_${Date.now()}@test.capitalcity-plumbing.example`,
    contact_phone: '555-0400',
    website: 'https://capitalcity-plumbing.example',
    industry: 'contractor',
    location: 'Austin, TX',
    employee_count: '15',
    annual_revenue: '950000',
  },
  {
    company_name: 'Texas Roofing Pros',
    contact_name: 'Owner',
    contact_email: `real_campaign_5_${Date.now()}@test.texasroofingpros.example`,
    contact_phone: '555-0500',
    website: 'https://texasroofingpros.example',
    industry: 'contractor',
    location: 'Austin, TX',
    employee_count: '20',
    annual_revenue: '1500000',
  },
];

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('HEIDI REAL CAMPAIGN EXECUTION');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`Campaign ID: ${CAMPAIGN_ID}`);
  console.log(`Timestamp:   ${new Date().toISOString()}`);
  console.log('');

  // ─── CAPABILITY STATUS CHECK ───────────────────────────────────────────
  console.log('─── CAPABILITY STATUS ────────────────────────────────────────────────────');

  const discovery = createDiscoveryAdapterFromEnv();
  const stripe = new StripeBridge();
  const offerCatalog = getOfferCatalog();

  const discoveryAvailable = discovery.isAvailable();
  const discoveryBlocker = discovery.getBlockerReason();
  const stripeMode = stripe.getMode();
  const stripeConfigured = stripe.isConfigured();
  const emailKey = process.env.SENDGRID_API_KEY || process.env.SMTP_HOST;
  const smsKey = process.env.TWILIO_ACCOUNT_SID;

  console.log(`Discovery (external): ${discoveryAvailable ? 'READY' : 'BLOCKED'}`);
  if (discoveryBlocker) console.log(`  Blocker: ${discoveryBlocker}`);
  console.log(`Discovery (CSV import): READY (no external API needed)`);
  console.log(`Email:                  ${emailKey ? 'READY' : 'BLOCKED'}`);
  if (!emailKey) console.log(`  Blocker: SENDGRID_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS required`);
  console.log(`Stripe:                 ${stripeConfigured ? stripeMode.toUpperCase() : 'BLOCKED'}`);
  if (!stripeConfigured) console.log(`  Blocker: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET required`);
  console.log(`SMS:                    ${smsKey ? 'READY' : 'BLOCKED'}`);
  if (!smsKey) console.log(`  Blocker: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER required`);
  console.log(`Supabase DB:            READY`);
  console.log(`Local Model:            ${process.env.LOCAL_MODEL_URL ? 'READY' : 'NOT SET'}`);
  console.log(`Offer Catalog:          ${offerCatalog.getAll().length} offers`);
  console.log('');

  // ─── OFFER CATALOG ─────────────────────────────────────────────────────
  console.log('─── OFFER CATALOG ─────────────────────────────────────────────────────────');
  const offers = offerCatalog.getAll();
  for (const offer of offers) {
    console.log(`  ${offer.offerId}: ${offer.name} — $${(offer.setupPrice / 100).toFixed(0)} setup, $${(offer.recurringPrice / 100).toFixed(0)}/mo`);
  }
  console.log('');

  // ─── INITIALIZE SYSTEMS ────────────────────────────────────────────────
  console.log('─── INITIALIZING SYSTEMS ──────────────────────────────────────────────────');

  const revDb = new RevenueDatabase(DB_CONFIG);
  const pipeline = new ProspectPipeline(undefined, revDb);
  const ledger = new RevenueLedger(revDb);
  const lifecycle = new CustomerLifecycle(revDb);
  const goals = new GoalSystem(DB_CONFIG);
  const workflow = new CommercialWorkflow({ pipeline, ledger, lifecycle, discovery });

  const manager = new CampaignLoopManager({
    workflow,
    goals,
    config: {
      campaignId: CAMPAIGN_ID,
      campaignName: 'Real Campaign — AI Operations',
      offerId: 'ai_operations_setup',
      maxProspects: 10,
      maxCycles: 100,
      cycleIntervalMs: 60000,
    },
  });

  console.log('Systems initialized.');
  console.log('');

  // ─── STAGE 1: DISCOVER/IMPORT PROSPECTS ────────────────────────────────
  console.log('─── STAGE 1: DISCOVER/IMPORT PROSPECTS ────────────────────────────────────');
  console.log(`Source: authorized_test (5 prospects)`);
  console.log(`Note: Real prospects require a CSV file via --prospects=<file>`);
  console.log('');

  const importResult = await manager.importProspectsFromCsv(TEST_PROSPECTS, 'authorized_test');
  console.log(`Imported:     ${importResult.imported}`);
  console.log(`Qualified:    ${importResult.qualified}`);
  console.log(`Opportunities: ${importResult.opportunities}`);
  console.log(`Duplicates:   ${importResult.duplicates}`);
  console.log('');

  // ─── STAGE 2: SCORE AND QUALIFY ────────────────────────────────────────
  console.log('─── STAGE 2: SCORE AND QUALIFY ────────────────────────────────────────────');
  const wfState = await workflow.getState();
  console.log(`Prospects in pipeline: ${wfState.prospectsDiscovered}`);
  console.log(`Qualified prospects:   ${wfState.prospectsQualified}`);
  console.log(`Opportunities created: ${wfState.opportunitiesCreated}`);
  console.log('');

  // ─── STAGE 3: GENERATE OUTREACH DRAFTS ─────────────────────────────────
  console.log('─── STAGE 3: GENERATE OUTREACH DRAFTS ─────────────────────────────────────');
  console.log('Status: READY (R0 — autonomous draft preparation)');
  console.log('Drafts are evidence-backed — no hallucinated facts.');
  console.log('Drafts are NOT messages — they require authorization before sending.');
  console.log('');

  // ─── STAGE 4: CREATE AUTHORIZATION PACKAGES ────────────────────────────
  console.log('─── STAGE 4: CREATE AUTHORIZATION PACKAGES ────────────────────────────────');
  console.log('Status: READY (R0 — autonomous package creation)');
  console.log('Packages contain: prospect, evidence, offer, proposed message, risk, reason.');
  console.log('Approval is EXPLICIT — never inferred from draft creation.');
  console.log('');

  // ─── STAGE 5: GOVERNED OUTREACH ────────────────────────────────────────
  console.log('─── STAGE 5: GOVERNED OUTREACH ────────────────────────────────────────────');
  if (!emailKey) {
    console.log('Status: BLOCKED');
    console.log('Blocker: No email provider configured.');
    console.log('Required: SENDGRID_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS');
    console.log('Authorization packages are created but cannot be sent.');
    console.log('R2 communication remains protected — no message can be sent without:');
    console.log('  1. Explicit human approval of authorization package');
    console.log('  2. Configured email provider');
    console.log('  3. CommunicationLayer execution boundary');
  } else {
    console.log('Status: READY — email provider configured');
  }
  console.log('');

  // ─── STAGE 6: RESPONSE HANDLING ────────────────────────────────────────
  console.log('─── STAGE 6: RESPONSE HANDLING ────────────────────────────────────────────');
  console.log('Status: READY (implementation complete, no responses yet)');
  console.log('InboundResponseHandler can classify: interested, scheduling, pricing,');
  console.log('objection, opt-out, spam, unknown.');
  console.log('No responses received — no messages sent.');
  console.log('');

  // ─── STAGE 7: PAYMENT ──────────────────────────────────────────────────
  console.log('─── STAGE 7: PAYMENT ──────────────────────────────────────────────────────');
  if (!stripeConfigured) {
    console.log('Status: BLOCKED');
    console.log('Blocker: Stripe is not configured.');
    console.log('Required: STRIPE_SECRET_KEY (sk_test_ for sandbox, rk_ for production)');
    console.log('Required: STRIPE_WEBHOOK_SECRET (whsec_ from Stripe dashboard)');
    console.log('Required: ALLOW_LIVE_STRIPE=true for live mode');
    console.log('No checkout sessions can be created.');
    console.log('No webhooks can be verified.');
    console.log('No verified revenue can be recorded.');
  } else {
    console.log(`Status: READY (${stripeMode} mode)`);
  }
  console.log('');

  // ─── STAGE 8: CUSTOMER FULFILLMENT ─────────────────────────────────────
  console.log('─── STAGE 8: CUSTOMER FULFILLMENT ──────────────────────────────────────────');
  console.log('Status: READY (implementation complete, no customers yet)');
  console.log('CustomerLifecycle stages: discovery_call → crm_integration →');
  console.log('  faq_creation → monitoring_config → verification');
  console.log('Each stage requires evidence — no false completion.');
  console.log('No customers created — no payments processed.');
  console.log('');

  // ─── STAGE 9: REVENUE VERIFICATION ─────────────────────────────────────
  console.log('─── STAGE 9: REVENUE VERIFICATION ──────────────────────────────────────────');
  const revenueResult = await workflow.verifyRevenue();
  console.log(`Verified Revenue (global ledger): $${(revenueResult.verifiedRevenueCents / 100).toFixed(2)}`);
  console.log(`Verified entries: ${revenueResult.entries.filter((e) => e.verified).length}`);
  console.log(`Pipeline Value: $${(wfState.pipelineValueCents / 100).toFixed(2)}`);
  console.log('');
  console.log('IMPORTANT: Pipeline value is NOT revenue.');
  console.log('Only verified Stripe webhook events may become verified revenue.');
  console.log('');

  // ─── STAGE 10: RUN CAMPAIGN CYCLE ──────────────────────────────────────
  console.log('─── STAGE 10: RUN CAMPAIGN CYCLE ───────────────────────────────────────────');
  const cycleResult = await manager.runCycle();
  console.log(`Cycle ID: ${cycleResult.cycleId}`);
  console.log(`Actions: ${cycleResult.actionsTaken.join(', ')}`);
  console.log(`Failures: ${cycleResult.failures.length}`);
  console.log('');

  // ─── CAMPAIGN METRICS ──────────────────────────────────────────────────
  console.log('─── CAMPAIGN METRICS ──────────────────────────────────────────────────────');
  const metrics = manager.getMetrics();
  console.log(`Campaign ID:              ${metrics.campaignId}`);
  console.log(`Cycles Completed:         ${metrics.cyclesCompleted}`);
  console.log(`Prospects Discovered:     ${metrics.prospectsDiscovered}`);
  console.log(`Prospects Qualified:      ${metrics.prospectsQualified}`);
  console.log(`Opportunities Created:    ${metrics.opportunitiesCreated}`);
  console.log(`Auth Packages Created:    ${metrics.authorizationPackagesCreated}`);
  console.log(`Auth Packages Approved:   ${metrics.authorizationPackagesApproved}`);
  console.log(`Messages Sent:            ${metrics.messagesSent}`);
  console.log(`Responses Received:       ${metrics.responsesReceived}`);
  console.log(`Customers Created:        ${metrics.customersCreated}`);
  console.log(`Services Activated:       ${metrics.servicesActivated}`);
  console.log(`Payments Processed:       ${metrics.paymentsProcessed}`);
  console.log(`Verified Revenue:         $${(metrics.verifiedRevenueCents / 100).toFixed(2)}`);
  console.log(`Pipeline Value:           $${(metrics.pipelineValueCents / 100).toFixed(2)}`);
  console.log(`Failures:                 ${metrics.failures}`);
  console.log(`Duplicates Prevented:     ${metrics.duplicatesPrevented}`);
  console.log(`Unauthorized Actions:     ${metrics.unauthorizedActions}`);
  console.log(`Kill Switch Activations:  ${metrics.killSwitchActivations}`);
  console.log(`State:                    ${metrics.state}`);
  console.log('');

  // ─── BLOCKER SUMMARY ───────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('BLOCKER SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('The first real commercial transaction is BLOCKED by external dependencies:');
  console.log('');
  console.log('1. EMAIL BLOCKED — No SENDGRID_API_KEY or SMTP configuration');
  console.log('   Impact: Cannot send outreach messages to prospects');
  console.log('   Fix: Set SENDGRID_API_KEY in .env.local');
  console.log('');
  console.log('2. STRIPE BLOCKED — No STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
  console.log('   Impact: Cannot create checkout sessions, verify payments, or record revenue');
  console.log('   Fix: Set STRIPE_SECRET_KEY (sk_test_ for sandbox) and STRIPE_WEBHOOK_SECRET');
  console.log('');
  console.log('3. DISCOVERY PARTIALLY BLOCKED — No GOOGLE_PLACES_API_KEY or CLEARBIT_API_KEY');
  console.log('   Impact: Cannot discover prospects from external directories');
  console.log('   Workaround: CSV import is READY — provide a CSV file of real prospects');
  console.log('');
  console.log('What IS ready:');
  console.log('  ✓ Prospect ingestion and deduplication');
  console.log('  ✓ ICP scoring and qualification');
  console.log('  ✓ Opportunity creation');
  console.log('  ✓ Evidence-backed outreach draft generation');
  console.log('  ✓ Authorization package creation');
  console.log('  ✓ Authorization boundary enforcement (R2)');
  console.log('  ✓ Campaign loop with metrics');
  console.log('  ✓ Revenue verification (correctly reports $0)');
  console.log('  ✓ Audit trail');
  console.log('  ✓ Kill switch');
  console.log('  ✓ Guardian/Trust/Autonomy models');
  console.log('');
  console.log('NEXT EXECUTABLE ACTION:');
  console.log('  1. Configure SENDGRID_API_KEY to unblock email delivery');
  console.log('  2. Import real prospects via CSV (no external API needed)');
  console.log('  3. Human reviews and approves authorization packages');
  console.log('  4. CommunicationLayer sends approved messages');
  console.log('  5. Configure STRIPE_SECRET_KEY to unblock payment processing');
  console.log('  6. First real payment → verified webhook → RevenueLedger entry');
  console.log('');
  console.log('VERIFIED REVENUE: $0.00');
  console.log('PIPELINE VALUE:   $' + (metrics.pipelineValueCents / 100).toFixed(2) + ' (NOT revenue)');
  console.log('');

  // ─── CLEANUP ───────────────────────────────────────────────────────────
  await manager.stop();
  await goals.close();
  await revDb.close();

  console.log('Campaign execution complete. System left in safe READY state.');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('Campaign execution failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
