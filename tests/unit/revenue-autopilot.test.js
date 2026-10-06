'use strict';

/**
 * RevenueAutopilotMission tests — the thin spine: durable objective goal,
 * stage machine, human-boundary parking, verifier-gated resume, and the
 * NEXT BEST ACTION briefing. Isolated store per run.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-ra-')), 'human-actions.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { HumanActionService } = require('../../lib/human-actions/service');
const { runVerifier } = require('../../lib/human-actions/verifiers');
const { advance, brief, offerForOpportunity } = require('../../lib/revenue/revenue-autopilot');
const { getOfferCatalog } = require('../../lib/revenue/OfferCatalog');

/** In-memory GoalSystem stand-in incl. createGoal. */
function fakeGoals(seed = []) {
  const store = new Map(seed.map((g) => [g.goalId, { evidence: [], context: {}, ...g }]));
  return {
    store,
    async getGoal(id) { return store.get(id) || null; },
    async createGoal(g) {
      const goal = { goalId: 'goal_' + Math.random().toString(16).slice(2, 10), createdAt: new Date().toISOString(), evidence: [], status: 'pending', ...g };
      store.set(goal.goalId, goal);
      return goal;
    },
    async updateGoal(id, u) {
      const g = store.get(id);
      if (!g) return null;
      if (u.status) g.status = u.status;
      if (u.context) g.context = u.context;
      if (u.evidence) g.evidence = [...(g.evidence || []), ...u.evidence];
      return g;
    },
    async listGoals(f = {}) { return [...store.values()].filter((g) => !f.status || g.status === f.status); },
  };
}

function fakeStore(opps) {
  const byId = new Map(opps.map((o) => [o.id, o]));
  return {
    byId,
    async listOpportunities() { return [...byId.values()]; },
    async getOpportunity(id) { return byId.get(id) || null; },
  };
}

const PHILIPS = {
  id: 'opp_philips', title: 'Philips Fixables — manufacturer ships 3D-printable replacement parts',
  confidence: 45, approval_status: 'approved', status: 'needs_review', source_url: 'https://example.test/x', summary: '', scoring_detail: {},
};
const PENDING_OPP = {
  id: 'opp_pending', title: 'Music generation model — song creation service',
  confidence: 48, approval_status: 'pending', status: 'needs_review', scoring_detail: {},
};

function depsFor(store, envPresent = () => false) {
  const goals = fakeGoals();
  const service = new HumanActionService({ verifierDeps: { opportunityStore: store } });
  return { goals, service, opportunityStore: store, catalog: getOfferCatalog(), envNamePresent: envPresent, actor: 'test' };
}

describe('offerForOpportunity', () => {
  const catalog = getOfferCatalog();
  test('3d-printing signal maps to the protoforge offer', () => {
    const { offer, matchedCategory } = offerForOpportunity(PHILIPS, catalog);
    expect(matchedCategory).toBe('protoforge');
    expect(offer.offerId).toBe('protoforge_model_prep');
    expect(offer.setupPrice).toBeGreaterThan(0);
  });
  test('music signal maps to the rezonate offer', () => {
    const { offer } = offerForOpportunity(PENDING_OPP, catalog);
    expect(offer.offerId).toBe('rezonate_song');
  });
});

describe('verifiers', () => {
  test('opportunity-approved: pending fails, approved passes', async () => {
    const store = fakeStore([PENDING_OPP, PHILIPS]);
    const bad = await runVerifier('opportunity-approved', { opportunityId: 'opp_pending' }, { opportunityStore: store });
    expect(bad.passed).toBe(false);
    expect(bad.failureReason).toMatch(/pending/);
    const good = await runVerifier('opportunity-approved', { opportunityId: 'opp_philips' }, { opportunityStore: store });
    expect(good.passed).toBe(true);
    const missing = await runVerifier('opportunity-approved', { opportunityId: 'nope' }, { opportunityStore: store });
    expect(missing.passed).toBe(false);
  });

  test('live-auth-issued: no file fails, fresh PENDING passes, expired fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lta-'));
    const p = path.join(dir, 'auth.json');
    const missing = await runVerifier('live-auth-issued', { storePath: p });
    expect(missing.passed).toBe(false);
    fs.writeFileSync(p, JSON.stringify({
      a1: { authorizationId: 'a1', state: 'PENDING', scope: 's', expiresAt: new Date(Date.now() + 60000).toISOString(), authorizedBy: 'op' },
    }));
    const ok = await runVerifier('live-auth-issued', { storePath: p });
    expect(ok.passed).toBe(true);
    fs.writeFileSync(p, JSON.stringify({
      a1: { authorizationId: 'a1', state: 'PENDING', expiresAt: new Date(Date.now() - 60000).toISOString() },
      a2: { authorizationId: 'a2', state: 'CONSUMED', expiresAt: new Date(Date.now() + 60000).toISOString() },
    }));
    const stale = await runVerifier('live-auth-issued', { storePath: p });
    expect(stale.passed).toBe(false);
  });
});

describe('revenue autopilot', () => {
  test('selects approved opportunity, prepares offer, parks on prerequisites', async () => {
    const store = fakeStore([PENDING_OPP, PHILIPS]);
    const deps = depsFor(store, () => false); // no env at all
    const report = await advance(deps);
    expect(report.opportunity.id).toBe('opp_philips'); // approved beats pending even at lower confidence
    expect(report.offer.offerId).toBe('protoforge_model_prep');
    expect(report.stage).toBe('WAITING_ON_HUMAN');

    const goal = await deps.goals.getGoal(report.goalId);
    expect(goal.status).toBe('escalated');
    expect(goal.context.waitingOnHuman).toBe(true);
    // STRIPE_WEBHOOK_SECRET + live-auth — approval is already satisfied
    const linked = deps.service.list({ includeTerminal: true }).filter((a) => a.sourceGoalId === goal.goalId);
    expect(linked.length).toBe(2);
    const keys = linked.map((a) => a.blockerKey).sort();
    expect(keys).toEqual(['stripe:live-transaction-authorization', 'stripe:webhook-secret']);

    // idempotent — a second pass does not duplicate
    const again = await advance(deps);
    expect(again.stage).toBe('WAITING_ON_HUMAN');
    expect(deps.service.list({ includeTerminal: true }).filter((a) => a.sourceGoalId === goal.goalId).length).toBe(2);
  });

  test('pending opportunity parks on the approval boundary', async () => {
    const store = fakeStore([PENDING_OPP]);
    const deps = depsFor(store, () => false);
    const report = await advance(deps);
    expect(report.opportunity.id).toBe('opp_pending');
    expect(report.stage).toBe('WAITING_ON_HUMAN');
    const actions = deps.service.list({ includeTerminal: true });
    expect(actions.some((a) => a.blockerKey === 'opportunity:opp_pending:approval')).toBe(true);
  });

  test('verify → resume → payable: the full loop on real checks', async () => {
    const store = fakeStore([PHILIPS]);
    // STRIPE_WEBHOOK_SECRET present from the start → only live-auth parks
    const deps = depsFor(store, (n) => n === 'STRIPE_WEBHOOK_SECRET');
    const r1 = await advance(deps);
    expect(r1.stage).toBe('WAITING_ON_HUMAN');
    const authAction = deps.service.list({ includeTerminal: true }).find((a) => a.blockerKey === 'stripe:live-transaction-authorization');
    expect(authAction).toBeTruthy();

    // Simulate the human issuing a fresh authorization — the verifier
    // reads the real store file (spec default path is overridable only in
    // spec; here we write the default location in-process via a temp cwd
    // — so instead we verify through the spec path used by the action).
    const ltaDir = path.join(process.cwd(), '.hydi-operational');
    const ltaPath = path.join(ltaDir, 'live-transaction-authorization.json');
    const hadFile = fs.existsSync(ltaPath);
    const prior = hadFile ? fs.readFileSync(ltaPath, 'utf8') : null;
    try {
      if (!fs.existsSync(ltaDir)) fs.mkdirSync(ltaDir, { recursive: true });
      fs.writeFileSync(ltaPath, JSON.stringify({
        live1: { authorizationId: 'live1', state: 'PENDING', scope: 's', expiresAt: new Date(Date.now() + 60000).toISOString(), authorizedBy: 'test' },
      }));
      const v = await deps.service.verify(authAction.id, 'test');
      expect(v.action.status).toBe('RESOLVED');

      const r2 = await advance(deps);
      expect(r2.stage).toBe('payable_ready');
      const goal = await deps.goals.getGoal(r2.goalId);
      expect(goal.status).toBe('pending'); // runnable, NOT completed
      expect(goal.context.waitingOnHuman).toBeFalsy();
      expect(goal.context.autopilot.payableReady).toBe(true);
      const ev = (goal.evidence || []).find((e) => e.type === 'PAYABLE_OFFER_READY');
      expect(ev).toBeTruthy();
      expect(ev.priceCents).toBe(2900);
    } finally {
      if (prior !== null) fs.writeFileSync(ltaPath, prior);
      else if (fs.existsSync(ltaPath)) fs.unlinkSync(ltaPath);
    }
  });

  test('brief() renders NEXT BEST ACTION with waiting prerequisites', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, () => false);
    const { text } = await brief(deps);
    expect(text).toMatch(/NEXT BEST ACTION/);
    expect(text).toMatch(/Philips Fixables/);
    expect(text).toMatch(/protoforge_model_prep|3D-Printable Model Preparation/);
    expect(text).toMatch(/WAITING ON HUMAN/);
    expect(text).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  test('empty queue → awaiting_opportunity, no fabricated work', async () => {
    const deps = depsFor(fakeStore([]));
    const report = await advance(deps);
    expect(report.stage).toBe('awaiting_opportunity');
  });
});
