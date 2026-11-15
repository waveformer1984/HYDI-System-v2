'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScout } = require('../../lib/job-scout/scout');
const { syncFromScoutLeads, loadStore, saveStore, opsDir } = require('../../lib/revenue-ops/store');
const { listConnectors, connectorHealth } = require('../../lib/revenue-ops/connectors');
const { listCapabilities } = require('../../lib/revenue-ops/capabilities');
const { assessOpportunity } = require('../../lib/revenue-ops/scoring');
const {
  queueForApproval,
  approveProposal,
  submitProposal,
} = require('../../lib/revenue-ops/approval');
const {
  simulateClientAccept,
  approveExecution,
  startContractExecution,
} = require('../../lib/revenue-ops/execution-bridge');

const CONFIG = {
  minScore: 35,
  draftScore: 60,
  maxLeads: 50,
  retentionDays: 30,
  minFixedBudgetUsd: 150,
  minHourlyUsd: 20,
  negativeKeywords: ['unpaid'],
  sources: { freelancer: { enabled: true, queries: ['react'] }, remotive: { enabled: false }, remoteok: { enabled: false }, hn: { enabled: false } },
  divisions: { AppForge: { pitch: 'web', keywords: ['react', 'next.js', 'stripe'] } },
};

const FREELANCER_FIXTURE = {
  status: 'success',
  result: {
    projects: [{
      id: 501,
      title: 'Next.js dashboard with Stripe integration',
      seo_url: 'nextjs/stripe-501',
      description: '<p>React Supabase API automation project</p>',
      budget: { minimum: 800, maximum: 2000 },
      currency: { code: 'USD' },
      type: 'fixed',
      time_submitted: Date.now() / 1000 - 86400,
      jobs: [{ name: 'React.js' }, { name: 'Stripe' }],
      bid_stats: { bid_count: 3 },
    }],
  },
};

function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

function tempEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-ops-'));
  const scoutDir = path.join(root, 'job-scout');
  const revDir = path.join(root, 'revenue-ops');
  fs.mkdirSync(scoutDir, { recursive: true });
  fs.mkdirSync(revDir, { recursive: true });
  const env = {
    JOB_SCOUT_DIR: scoutDir,
    REVENUE_OPS_DIR: revDir,
    JOB_SCOUT_CONFIG: path.join(root, 'job-scout.json'),
    REVENUE_OPS_CONFIG: path.join(root, 'revenue-ops.json'),
  };
  fs.writeFileSync(env.JOB_SCOUT_CONFIG, JSON.stringify(CONFIG));
  fs.writeFileSync(env.REVENUE_OPS_CONFIG, JSON.stringify({
    minNetProfitUsd: 50,
    minOpportunityScore: 40,
    maxRiskScore: 80,
  }));
  return { root, env };
}

describe('revenue operations acceptance (mocked)', () => {
  it('connector registry reports blocked marketplaces honestly', () => {
    const connectors = listConnectors({ freelancer: { enabled: true } });
    const upwork = connectors.find((c) => c.id === 'upwork');
    expect(upwork.access).toBe('blocked');
    expect(upwork.blockReason).toMatch(/API/);
  });

  it('capability catalog lists verified skills with evidence', () => {
    const caps = listCapabilities();
    expect(caps.length).toBeGreaterThan(5);
    expect(caps.find((c) => c.id === 'web_fullstack').executionReady).toBe(true);
  });

  it('end-to-end: discover → score → proposal → approval gate → fabric job (simulated)', async () => {
    const { env } = tempEnv();
    const fetchImpl = fakeFetch({ 'freelancer.com': FREELANCER_FIXTURE });
    await runScout({ fetchImpl, config: CONFIG, env, now: Date.now() });
    const leads = JSON.parse(fs.readFileSync(path.join(env.JOB_SCOUT_DIR, 'leads.json'), 'utf8')).leads;
    expect(leads.length).toBeGreaterThan(0);
    const lead = leads[0];
    lead.draft = 'Hi — we build Next.js systems with tests.';
    syncFromScoutLeads([lead], { env });

    const store = loadStore(opsDir(env));
    let opp = store.opportunities.find((o) => o.leadId === lead.id);
    expect(opp).toBeTruthy();
    expect(opp.listingAvailable).toBe(true);
    expect(opp.assessment.qualified).toBe(true);
    expect(['PROPOSAL_READY', 'QUALIFIED']).toContain(opp.state);

    if (opp.state === 'QUALIFIED') {
      const { buildProposal } = require('../../lib/revenue-ops/proposal');
      opp.proposal = buildProposal(opp, lead);
      opp.state = 'PROPOSAL_READY';
    }
    expect(opp.proposal.version).toBeTruthy();

    queueForApproval(store, opp.id);
    expect(store.opportunities.find((o) => o.id === opp.id).state).toBe('AWAITING_APPROVAL');

    const blocked = submitProposal(store, opp.id, 'tester', { simulate: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);

    approveProposal(store, opp.id, 'human:jordan', opp.proposal.version);
    const submitted = submitProposal(store, opp.id, 'human:jordan', { simulate: true });
    expect(submitted.ok).toBe(true);
    expect(submitted.simulated).toBe(true);

    simulateClientAccept(store, opp.id, 'human:jordan');
    approveExecution(store, opp.id, 'human:jordan');
    const exec = await startContractExecution(store, opp.id, 'human:jordan', { simulate: true });
    expect(exec.ok).toBe(true);
    opp = store.opportunities.find((o) => o.id === opp.id);
    expect(opp.state).toBe('PAID');
    expect(opp.fabricTaskId).toBeTruthy();
    expect(opp.financials.paymentStatus).toBe('simulated_paid');
    saveStore(opsDir(env), store);

    const health = connectorHealth({ ranAt: new Date().toISOString(), sources: { freelancer: { ok: true, count: 1 } } }, CONFIG.sources);
    expect(health.find((c) => c.id === 'freelancer').lastOk).toBe(true);
  });

  it('rejects proposal when approval version mismatches', () => {
    const { env } = tempEnv();
    const store = loadStore(opsDir(env));
    store.opportunities.push({
      id: 'abc',
      state: 'AWAITING_APPROVAL',
      proposal: { version: 'v1', body: 'x' },
    });
    expect(() => approveProposal(store, 'abc', 'human:jordan', 'v2')).toThrow();
  });

  it('assessment rejects when economics are not viable', () => {
    const lead = {
      title: 'tiny react fix',
      description: 'react',
      skills: ['react'],
      budget: { min: 10, max: 20, currency: 'USD', type: 'fixed' },
      score: 50,
    };
    const a = assessOpportunity(lead, { minNetProfitUsd: 500 });
    expect(a.qualified).toBe(false);
    expect(a.rejectReason).toBe('below_min_net_profit');
  });
});