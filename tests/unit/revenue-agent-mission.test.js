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
  isContactReady,
} = require('../../lib/revenue-ops/customer-pipeline');
const { main: seedProspects } = require('../../scripts/seed-revenue-prospects');
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

  test('seed prospects stay DISCOVERED with synthetic true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-seed-'));
    process.env.REVENUE_PIPELINE_DIR = dir;
    seedProspects();
    const data = loadProspects(dir);
    expect(data.prospects.length).toBe(10);
    for (const p of data.prospects) {
      expect(p.status).toBe('DISCOVERED');
      expect(p.synthetic).toBe(true);
    }
    delete process.env.REVENUE_PIPELINE_DIR;
  });

  test('QUALIFIED rejected without VERIFIED evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-pipe-'));
    const data = loadProspects(dir);
    const p = addProspect(data, {
      businessName: 'Test Detail LLC',
      evidence: [{ type: 'HYPOTHESIS', note: 'guess only' }],
    });
    transitionProspect(data, p.id, 'RESEARCHED');
    expect(() => transitionProspect(data, p.id, 'QUALIFIED')).toThrow(/verified_evidence/);
    p.evidence.push({
      type: 'VERIFIED',
      source_url: 'https://maps.google.com/example',
      verified_by: 'jordan',
    });
    expect(() => transitionProspect(data, p.id, 'QUALIFIED')).not.toThrow();
  });

  test('synthetic prospects cannot reach CONTACT_APPROVED or CONTACTED', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-syn-'));
    const data = loadProspects(dir);
    const p = addProspect(data, {
      businessName: 'Synthetic Shop',
      synthetic: true,
      evidence: [{ type: 'VERIFIED', source_url: 'https://example.com', verified_by: 'jordan' }],
    });
    transitionProspect(data, p.id, 'RESEARCHED');
    transitionProspect(data, p.id, 'QUALIFIED');
    expect(() => transitionProspect(data, p.id, 'CONTACT_APPROVED')).toThrow(/synthetic/);
    p.synthetic = false;
    transitionProspect(data, p.id, 'CONTACT_APPROVED');
    expect(() => transitionProspect(data, p.id, 'CONTACTED')).toThrow(/owner_contact_approval/);
    p.contactConsent = { ownerApproved: true, at: new Date().toISOString() };
    expect(() => transitionProspect(data, p.id, 'CONTACTED')).not.toThrow();
  });

  test('revenue-agent contactReady excludes synthetic qualified prospects', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-agent-syn-'));
    const env = {
      REVENUE_OPS_DIR: path.join(root, 'ops'),
      REVENUE_PIPELINE_DIR: path.join(root, 'pipe'),
      REVENUE_LEDGER_DIR: path.join(root, 'led'),
    };
    fs.mkdirSync(env.REVENUE_OPS_DIR, { recursive: true });
    fs.writeFileSync(path.join(env.REVENUE_OPS_DIR, 'opportunities.json'), JSON.stringify({ opportunities: [], audit: [] }));
    const pipe = loadProspects(env.REVENUE_PIPELINE_DIR);
    addProspect(pipe, {
      businessName: 'Real Shop',
      synthetic: false,
      evidence: [{ type: 'VERIFIED', source_url: 'https://yelp.com/biz/x', verified_by: 'jordan' }],
    });
    pipe.prospects[0].status = 'QUALIFIED';
    addProspect(pipe, { businessName: 'Fake Shop', synthetic: true, status: 'QUALIFIED' });
    pipe.prospects[1].status = 'QUALIFIED';
    saveProspects(env.REVENUE_PIPELINE_DIR, pipe);
    expect(pipe.prospects.filter(isContactReady).length).toBe(1);
    const report = await runDailyWorkflow({ env });
    const contactAction = report.nextActions.find((a) => a.action === 'request_owner_contact_approval');
    expect(contactAction?.count).toBe(1);
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