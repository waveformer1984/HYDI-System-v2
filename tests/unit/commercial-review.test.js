'use strict';

/**
 * Commercial layer tests — the governed pricing path:
 *
 *   manifest.commercial → proposal → Human Action (decision payload)
 *     → recorded human decision → offer materializes into the catalog
 *     overlay → offer-exists proves it → realization completes.
 *
 * Pricing is human authority: nothing here lets a price exist without a
 * recorded decision, and the durable truth is always the catalog, never
 * the decision record alone.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commercial-'));
const actionsFile = path.join(tmpDir, 'human-actions.json');
const decisionsFile = path.join(tmpDir, 'commercial-decisions.json');
const offersFile = path.join(tmpDir, 'approved-offers.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = actionsFile;
process.env.HYDI_COMMERCIAL_DECISIONS_PATH = decisionsFile;
process.env.HYDI_APPROVED_OFFERS_PATH = offersFile;

const { recordDecision, getDecision } = require('../../lib/commercial/decision-store');
const { buildProposal, buildReviewActionSpec, materializeApprovedOffer } = require('../../lib/commercial/commercial-review');
const { runVerifier } = require('../../lib/human-actions/verifiers');
const { HumanActionService } = require('../../lib/human-actions/service');
const { advance } = require('../../lib/realization/app-realization');
const { OfferCatalog } = require('../../lib/revenue/OfferCatalog');

let goalSeq = 0;
function fakeGoals() {
  const store = new Map();
  return {
    store,
    async createGoal(input) {
      const g = { goalId: `cg_${++goalSeq}`, status: 'pending', evidence: [], ...input, context: input.context || {} };
      store.set(g.goalId, g);
      return g;
    },
    async getGoal(id) { return store.get(id) || null; },
    async updateGoal(id, patch) {
      const g = store.get(id);
      if (g && patch.context) g.context = patch.context;
      if (g && patch.status) g.status = patch.status;
      return g;
    },
    async listGoals() { return [...store.values()]; },
  };
}

function fixtureApp() {
  return {
    appId: 'fixture-svc',
    dir: '/nonexistent',
    manifest: {
      name: 'Fixture Service',
      version: '0.1.0',
      capabilities: ['audit-things'],
      realization: { hosted: 'test-engine', offerId: 'fixture_audit' },
      commercial: {
        offerId: 'fixture_audit',
        offerName: 'Fixture Audit',
        customerProblem: 'a real problem',
        deliverable: 'a real report',
        targetCustomer: 'small teams',
        category: 'service_audit',
        recommendedPriceCents: 4900,
        priceBasis: 'test basis',
        unitEconomics: 'near-zero marginal cost',
        marketEvidence: 'none recorded',
        confidencePct: 55,
        implementationRequirements: ['workflow_description'],
        marginTarget: 0.9,
      },
    },
  };
}

describe('commercial decisions store', () => {
  test('round-trip: record → get; rejected then approved — latest wins', async () => {
    expect(getDecision('fixture_audit')).toBeNull();
    recordDecision({ offerId: 'fixture_audit', decision: 'rejected', approvedBy: 'j', notes: 'not yet' });
    expect(getDecision('fixture_audit').decision).toBe('rejected');
    recordDecision({ offerId: 'fixture_audit', decision: 'approved', approvedBy: 'j', priceCents: 3900 });
    const d = getDecision('fixture_audit');
    expect(d.decision).toBe('approved');
    expect(d.priceCents).toBe(3900);
    // append-only history
    const { history } = require('../../lib/commercial/decision-store').readStore(decisionsFile);
    expect(history.length).toBe(2);
  });

  test('rejects invalid input', () => {
    expect(() => recordDecision({ decision: 'approved' })).toThrow('offerId');
    expect(() => recordDecision({ offerId: 'x', decision: 'maybe' })).toThrow('invalid decision');
  });
});

describe('commercial-approved verifier', () => {
  test('fails with no decision; fails on rejected; passes on approved', async () => {
    let r = await runVerifier('commercial-approved', { offerId: 'never_decided' });
    expect(r.passed).toBe(false);
    recordDecision({ offerId: 'v_test', decision: 'rejected', approvedBy: 'j' });
    r = await runVerifier('commercial-approved', { offerId: 'v_test' });
    expect(r.passed).toBe(false);
    recordDecision({ offerId: 'v_test', decision: 'approved', approvedBy: 'j' });
    r = await runVerifier('commercial-approved', { offerId: 'v_test' });
    expect(r.passed).toBe(true);
    expect(r.evidence.approvedBy).toBe('j');
  });
});

describe('commercial proposal', () => {
  test('buildProposal carries declared commercial intent + honest evidence fields', () => {
    const p = buildProposal(fixtureApp());
    expect(p.offerId).toBe('fixture_audit');
    expect(p.recommendedPriceCents).toBe(4900);
    expect(p.marketEvidence).toBe('none recorded');
    expect(p.confidencePct).toBe(55);
    expect(p.verifiedCapabilities).toEqual(['audit-things']);
  });

  test('missing commercial block → proposal with explicit gaps, not fabrications', () => {
    const app = fixtureApp();
    delete app.manifest.commercial;
    const p = buildProposal(app);
    expect(p.recommendedPriceCents).toBeNull();
    expect(p.customerProblem).toMatch(/not declared/);
  });

  test('action spec: decision instructions + offer-exists verifier (truth = catalog)', () => {
    const spec = buildReviewActionSpec(fixtureApp());
    expect(spec.blockerKey).toBe('app:fixture-svc:commercial');
    expect(spec.verifier.name).toBe('offer-exists');
    expect(spec.verifier.spec.offerId).toBe('fixture_audit');
    expect(spec.instructions.join(' ')).toMatch(/POST \/api\/commercial\/decisions/);
    expect(spec.context.proposal.customerProblem).toBe('a real problem');
  });
});

describe('materializeApprovedOffer — approval → OFFER_CREATED, never silent', () => {
  test('no decision → null; rejected → null; approved → offer in catalog overlay', async () => {
    const app = fixtureApp();
    const catalog = new OfferCatalog();
    const decisionless = { offerId: 'decisionless_offer' };
    expect(await materializeApprovedOffer({ ...app, manifest: { ...app.manifest, realization: { offerId: decisionless.offerId }, commercial: { offerId: decisionless.offerId } } }, { catalog })).toBeNull();

    recordDecision({ offerId: 'fixture_audit', decision: 'approved', approvedBy: 'j', priceCents: 5900 });
    const offer = await materializeApprovedOffer(app, { catalog });
    expect(offer.offerId).toBe('fixture_audit');
    expect(offer.setupPrice).toBe(5900); // human's number beats the recommendation
    expect(catalog.get('fixture_audit').setupPrice).toBe(5900);
    // Durable overlay — a fresh catalog instance sees it too.
    expect(new OfferCatalog().get('fixture_audit').setupPrice).toBe(5900);
    // offer-exists now passes — the durable proof
    const res = await runVerifier('offer-exists', { offerId: 'fixture_audit' });
    expect(res.passed).toBe(true);
  });

  test('approved with no price anywhere fails loudly — no silent default', async () => {
    const app = fixtureApp();
    app.manifest.realization = { offerId: 'noprice_offer' };
    app.manifest.commercial = { offerId: 'noprice_offer' };
    recordDecision({ offerId: 'noprice_offer', decision: 'approved', approvedBy: 'j' });
    await expect(materializeApprovedOffer(app, { catalog: new OfferCatalog() })).rejects.toThrow('no price');
  });
});

describe('realization revenue stage — governed commercial boundary', () => {
  test('no offer → parks on commercial action; approval → materialize → APP_REALIZED', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-app-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'CommApp', version: '0.1.0', capabilities: ['x'],
      realization: {
        hosted: 'test-engine',
        engineHealthUrl: 'http://engine.test/health',
        engineProbe: { method: 'POST', url: 'http://engine.test/x', body: {}, expectJsonField: 'id' },
        offerId: 'commapp_offer',
      },
      commercial: { offerId: 'commapp_offer', offerName: 'CommApp Offer', recommendedPriceCents: 2500, customerProblem: 'p', deliverable: 'd', marketEvidence: 'none' },
    }));
    const goals = fakeGoals();
    const fetch = async () => ({ status: 200, json: async () => ({ id: 1, project_id: 1 }) });
    const catalog = new OfferCatalog();
    const verifierDeps = { fetch, catalog };
    const service = new HumanActionService({ verifierDeps });
    const commercial = { ...require('../../lib/commercial/commercial-review'), materializeApprovedOffer: (app, d) => materializeApprovedOffer(app, { catalog }) };
    const deps = { goals, service, verifierDeps, catalog, commercial, appDir: () => dir, actor: 'test' };

    // Parked — commercial action carries the proposal, no offer exists.
    let r = await advance({ ...deps, appId: 'commapp' });
    expect(r.stage).toBe('WAITING_ON_HUMAN');
    const open = r.waiting.prerequisites.filter((p) => !['RESOLVED', 'CANCELLED', 'REJECTED'].includes(p.status));
    expect(open.map((p) => p.blockerKey)).toEqual(['app:commapp:commercial']);
    expect(catalog.get('commapp_offer')).toBeNull(); // no silent offer

    // Human approves at a modified price → next pass materializes + completes.
    recordDecision({ offerId: 'commapp_offer', decision: 'approved', approvedBy: 'j', priceCents: 3500 });
    r = await advance({ ...deps, appId: 'commapp' });
    expect(r.stage).toBe('APP_REALIZED');
    expect(catalog.get('commapp_offer').setupPrice).toBe(3500);
    expect(r.proof.type).toBe('APP_REALIZED');
  });
});
