'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { weightedScore, rankOpportunities } = require('../../lib/revenue-ops/product-opportunity-score');
const { PRODUCT_CATALOG } = require('../../lib/revenue-ops/product-catalog');
const {
  addProspect,
  loadProspects,
  saveProspects,
  transitionProspect,
} = require('../../lib/revenue-ops/customer-pipeline');
const {
  loadLedger,
  saveLedger,
  recordClearedPayment,
  hardwareReservePlan,
  ledgerDir,
} = require('../../lib/revenue-ops/financial-ledger');
const { runDailyWorkflow, requiresOwnerApproval } = require('../../lib/revenue-ops/revenue-agent');

describe('HYDI-REVENUE-001 revenue agent slice', () => {
  test('weighted product ranking selects detailer first', () => {
    const ranked = rankOpportunities(PRODUCT_CATALOG);
    expect(ranked[0].id).toBe('detailer_bot_sa');
    expect(ranked[0].score.total).toBeGreaterThan(60);
    expect(weightedScore(ranked[0].criteria).total).toBe(ranked[0].score.total);
  });

  test('outbound contact requires owner approval', () => {
    expect(requiresOwnerApproval('send_external_communication')).toBe(true);
    expect(requiresOwnerApproval('mark_paid_without_stripe')).toBe(true);
    expect(requiresOwnerApproval('research')).toBe(false);
  });

  test('prospect pipeline blocks contact without owner approval', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-pipe-'));
    const data = loadProspects(dir);
    const p = addProspect(data, { businessName: 'Test Detail LLC', website: 'https://example.com' });
    saveProspects(dir, data);
    const data2 = loadProspects(dir);
    transitionProspect(data2, p.id, 'RESEARCHED');
    transitionProspect(data2, p.id, 'QUALIFIED');
    transitionProspect(data2, p.id, 'CONTACT_APPROVED');
    expect(() => transitionProspect(data2, p.id, 'CONTACTED')).toThrow(/owner_contact_approval/);
    data2.prospects[0].contactConsent = { ownerApproved: true, at: new Date().toISOString() };
    expect(() => transitionProspect(data2, p.id, 'CONTACTED')).not.toThrow();
  });

  test('ledger records only verified payment ids', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-led-'));
    const ledger = loadLedger(dir);
    recordClearedPayment(ledger, { amountUsd: 200, stripePaymentId: 'pi_test_123', note: 'pilot' });
    saveLedger(dir, ledger);
    const plan = hardwareReservePlan(loadLedger(dir));
    expect(plan.buckets.hardwareExpansionUsd).toBeCloseTo(100, 1);
    expect(() => recordClearedPayment(ledger, { amountUsd: 50, stripePaymentId: '' })).toThrow(/payment_id/);
  });

  test('daily workflow runs read-only audit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-agent-'));
    const env = {
      REVENUE_OPS_DIR: path.join(root, 'ops'),
      REVENUE_PIPELINE_DIR: path.join(root, 'pipe'),
      REVENUE_LEDGER_DIR: path.join(root, 'led'),
    };
    fs.mkdirSync(env.REVENUE_OPS_DIR, { recursive: true });
    fs.writeFileSync(path.join(env.REVENUE_OPS_DIR, 'opportunities.json'), JSON.stringify({ opportunities: [], audit: [] }));
    const report = await runDailyWorkflow({ env });
    expect(report.ok).toBe(true);
    expect(report.rankedProducts[0].id).toBe('detailer_bot_sa');
    expect(report.prospects.count).toBe(0);
  });
});