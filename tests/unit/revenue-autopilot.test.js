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
const { advance, brief, status, resumeForPayment, offerForOpportunity } = require('../../lib/revenue/revenue-autopilot');
const { tryAutopilotAnswer, looksLikeStatusQuestion } = require('../../lib/revenue/autopilot-answer');
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

/** Fake revenue-runtime seam — the same shape JobManager/StripeBridge expose. */
function fakeRuntime({ paid = false, delivered = true, execOk = true, reconState = 'CONSISTENT' } = {}) {
  const jobs = new Map();
  let jobSeq = 0;
  const jobManager = {
    async createJob(input) {
      const job = {
        jobId: `job_test_${++jobSeq}`, customerEmail: input.customerEmail, customerName: input.customerName,
        product: input.product, requestText: input.requestText, requirements: input.requirements,
        priceCents: input.priceCents, currency: input.currency,
        jobStatus: 'created', paymentStatus: 'unpaid', deliveryStatus: 'pending',
        stripeCheckoutSessionId: null, paymentIntentId: null, artifactPaths: [],
      };
      jobs.set(job.jobId, job);
      return job;
    },
    async linkCheckoutSession(jobId, sessionId, url) {
      const j = jobs.get(jobId); j.stripeCheckoutSessionId = sessionId; j.paymentStatus = 'pending'; j.checkoutUrl = url;
    },
    async getJob(id) { return jobs.get(id) || null; },
  };
  const stripeBridge = {
    isConfigured: () => true,
    async createSetupCheckoutSession(input) {
      return { sessionId: 'cs_test_fake_' + jobSeq, url: 'https://checkout.stripe.test/' + jobSeq };
    },
  };
  const executeJob = async (jobId) => {
    const j = jobs.get(jobId);
    if (!execOk) { j.jobStatus = 'failed'; return { success: false, error: 'artifact verification failed', delivered: false }; }
    j.jobStatus = 'awaiting_review';
    j.artifactPaths = ['artifacts/' + jobId + '/part.stl'];
    if (delivered) { j.deliveryStatus = 'delivered'; j.jobStatus = 'delivered'; }
    return { success: true, artifacts: j.artifactPaths, delivered };
  };
  const reconciler = {
    async reconcile(jobId) {
      const j = jobs.get(jobId);
      return {
        state: reconState, jobId, summary: reconState + ' — fake',
        correlation: { jobId, checkoutSessionId: j?.stripeCheckoutSessionId || null, paymentIntentId: j?.paymentIntentId || null, ledgerEntryId: j?.paymentStatus === 'paid' ? 'le_test_1' : null, stripeEventId: j?.paymentStatus === 'paid' ? 'evt_test_1' : null },
        violations: reconState === 'CONSISTENT' ? [] : ['fake violation'],
      };
    },
  };
  return { jobs, jobManager, stripeBridge, executeJob, reconciler };
}

function depsFor(store, envPresent = () => false, runtime = null) {
  const goals = fakeGoals();
  const service = new HumanActionService({ verifierDeps: { opportunityStore: store, jobManager: runtime?.jobManager, envNamePresent: envPresent } });
  return {
    goals, service, opportunityStore: store, catalog: getOfferCatalog(),
    envNamePresent: envPresent, actor: 'test', stripeMode: 'test',
    customerEmail: 'buyer@test', ...(runtime || {}),
  };
}

const ALL_ENV = (n) => ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET_01', 'LIVE_QUALIFICATION_CUSTOMER_EMAIL'].includes(n);

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
  test('selects approved opportunity, prepares offer, parks on prerequisites (test mode)', async () => {
    const store = fakeStore([PENDING_OPP, PHILIPS]);
    const deps = depsFor(store, () => false); // no env at all
    const report = await advance(deps);
    expect(report.opportunity.id).toBe('opp_philips'); // approved beats pending even at lower confidence
    expect(report.offer.offerId).toBe('protoforge_model_prep');
    expect(report.stage).toBe('WAITING_ON_HUMAN');

    const goal = await deps.goals.getGoal(report.goalId);
    expect(goal.status).toBe('escalated');
    expect(goal.context.waitingOnHuman).toBe(true);
    // test mode: secret-key + webhook-secret + qualification-customer —
    // live-auth is NOT a test-path prerequisite
    const linked = deps.service.list({ includeTerminal: true }).filter((a) => a.sourceGoalId === goal.goalId);
    const keys = linked.map((a) => a.blockerKey).sort();
    expect(keys).toEqual(['revenue:qualification-customer', 'stripe:secret-key', 'stripe:webhook-secret']);

    // idempotent — a second pass does not duplicate
    const again = await advance(deps);
    expect(again.stage).toBe('WAITING_ON_HUMAN');
    expect(deps.service.list({ includeTerminal: true }).filter((a) => a.sourceGoalId === goal.goalId).length).toBe(3);
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

  test('live mode gates on live-auth; autopilot cannot self-issue', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, ALL_ENV);
    deps.stripeMode = 'live';
    const report = await advance(deps);
    expect(report.stage).toBe('WAITING_ON_HUMAN');
    const authAction = deps.service.list({ includeTerminal: true }).find((a) => a.blockerKey === 'stripe:live-transaction-authorization');
    expect(authAction).toBeTruthy();
    // No job may be created before authorization — the checkout seam refuses.
  });

  test('full test pipeline: gate → checkout → payment park → pay → execute → deliver → reconcile → TEST_PIPELINE_PROVEN', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime();
    const deps = depsFor(store, ALL_ENV, rt);

    // Pass 1: gates clear (env present, approved, customer via dep) →
    // checkout created → parked on the payment boundary.
    const r1 = await advance(deps);
    expect(r1.stage).toBe('WAITING_ON_HUMAN');
    const goal = await deps.goals.getGoal(r1.goalId);
    const ap = goal.context.autopilot;
    expect(ap.jobId).toMatch(/^job_test_/);
    expect(ap.checkoutSessionId).toMatch(/^cs_test_/);
    expect(ap.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test/);
    const paymentAction = deps.service.list({ includeTerminal: true }).find((a) => a.blockerKey === `revenue:payment:${ap.jobId}`);
    expect(paymentAction).toBeTruthy();
    expect(paymentAction.verifier.name).toBe('job-payment-status');

    // Unpaid cannot proceed — verifier fails honestly.
    const unpaid = await deps.service.verify(paymentAction.id, 'test');
    expect(unpaid.action.status).not.toBe('RESOLVED');

    // Pass 2 while unpaid: still parked, no duplicate job/session.
    const r2 = await advance(deps);
    expect(r2.stage).toBe('WAITING_ON_HUMAN');
    expect(rt.jobs.size).toBe(1);

    // Human pays — simulate the verified webhook landing.
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).paymentIntentId = 'pi_test_1';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';

    // Pass 3: verifier resolves the action, sweep releases the goal,
    // executor runs, delivery auto-approves, reconcile CONSISTENT → proven.
    const r3 = await advance(deps);
    expect(r3.stage).toBe('TEST_PIPELINE_PROVEN');
    expect(r3.proof.type).toBe('TEST_PIPELINE_PROVEN');
    expect(r3.proof.jobId).toBe(ap.jobId);
    expect(r3.proof.checkoutSessionId).toBe(ap.checkoutSessionId);
    expect(r3.proof.paymentIntentId).toBe('pi_test_1');
    expect(r3.proof.ledgerEntryId).toBe('le_test_1');
    expect(r3.proof.amountCents).toBe(2900);

    const done = await deps.goals.getGoal(r1.goalId);
    expect(done.status).toBe('completed');
    expect(done.context.autopilot.proof.type).toBe('TEST_PIPELINE_PROVEN');
    const resolved = deps.service.get(paymentAction.id);
    expect(resolved.status).toBe('RESOLVED');
  });

  test('delivery boundary: job needing human approval parks on job-delivered', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime({ delivered: false }); // QA doesn't auto-approve
    const deps = depsFor(store, ALL_ENV, rt);
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';
    const r2 = await advance(deps);
    expect(r2.stage).toBe('WAITING_ON_HUMAN');
    const deliveryAction = deps.service.list({ includeTerminal: true }).find((a) => a.blockerKey === `revenue:delivery:${ap.jobId}`);
    expect(deliveryAction).toBeTruthy();
    expect(deliveryAction.verifier.name).toBe('job-delivered');
    // Human approves → delivered → next pass proves.
    rt.jobs.get(ap.jobId).deliveryStatus = 'delivered';
    const r3 = await advance(deps);
    expect(r3.stage).toBe('TEST_PIPELINE_PROVEN');
  });

  test('reconciliation MISMATCH fails honestly — never proven', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime({ reconState: 'MISMATCH' });
    const deps = depsFor(store, ALL_ENV, rt);
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';
    const r2 = await advance(deps);
    expect(r2.stage).toBe('reconciliation_failed');
    const goal = await deps.goals.getGoal(r1.goalId);
    expect(goal.status).toBe('escalated');
    expect((goal.evidence || []).some((e) => e.type === 'RECONCILIATION_FAILED')).toBe(true);
  });

  test('reconciliation INCOMPLETE retries without proof', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime({ reconState: 'INCOMPLETE' });
    const deps = depsFor(store, ALL_ENV, rt);
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';
    const r2 = await advance(deps);
    expect(r2.stage).toBe('reconciling');
    const goal = await deps.goals.getGoal(r1.goalId);
    expect(goal.status).not.toBe('completed');
    expect(goal.context.autopilot.proof).toBeUndefined();
  });

  test('next mission cycle: proven opportunity is excluded, new goal created', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime();
    const deps = depsFor(store, ALL_ENV, rt);
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';
    const proven = await advance(deps);
    expect(proven.stage).toBe('TEST_PIPELINE_PROVEN');
    // Next advance → new mission instance, no eligible opportunities left.
    const r3 = await advance(deps);
    expect(r3.goalId).not.toBe(proven.goalId);
    expect(r3.stage).toBe('awaiting_opportunity');
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

  test('brief() surfaces TEST PIPELINE PROVEN evidence after completion', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime();
    const deps = depsFor(store, ALL_ENV, rt);
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).paymentIntentId = 'pi_test_1';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';
    await advance(deps);
    const { text } = await brief(deps);
    expect(text).toMatch(/TEST PIPELINE PROVEN/);
    expect(text).toMatch(/2900¢ usd/);
    expect(text).toMatch(/pi_test_1/);
    expect(text).toMatch(/test-mode/);
  });

  test('empty queue → awaiting_opportunity, no fabricated work', async () => {
    const deps = depsFor(fakeStore([]));
    const report = await advance(deps);
    expect(report.stage).toBe('awaiting_opportunity');
  });

  test('selection records durable rationale — why this opportunity over the others', async () => {
    const store = fakeStore([PENDING_OPP, PHILIPS]);
    const deps = depsFor(store, () => false);
    const report = await advance(deps);
    const ap = (await deps.goals.getGoal(report.goalId)).context.autopilot;
    expect(ap.selection).toBeTruthy();
    expect(ap.selection.chosenId).toBe('opp_philips');
    expect(ap.selection.reason).toMatch(/highest confidence|approved/);
    expect(ap.selection.considered.length).toBe(2);
    expect(ap.selection.considered.map((c) => c.id)).toContain('opp_pending');
    expect(ap.selection.poolSize).toBe(2);
  });

  test('status() is read-only — no goal created, no advance, durable truth only', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, ALL_ENV, fakeRuntime());
    // Empty system: a status question must not create the objective goal.
    const empty = await status(deps);
    expect(empty.text).toMatch(/No commercial objective|no active/i);
    expect((await deps.goals.listGoals()).length).toBe(0);

    // After a real run, status reports the durable stage without advancing.
    const r1 = await advance(deps);
    const goalBefore = await deps.goals.getGoal(r1.goalId);
    const stepsBefore = (goalBefore.context.autopilot.steps || []).length;
    const s = await status(deps);
    expect(s.stage).toBe('WAITING_ON_HUMAN');
    expect(s.text).toMatch(/COMMERCIAL STATUS/);
    expect(s.text).toMatch(/Philips Fixables/);
    expect(s.text).toMatch(/Why this one:/);
    expect(s.text).toMatch(/Waiting on human/);
    const goalAfter = await deps.goals.getGoal(r1.goalId);
    expect((goalAfter.context.autopilot.steps || []).length).toBe(stepsBefore); // nothing appended
  });

  test('status() shows job lifecycle once the mission owns a job', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime();
    const deps = depsFor(store, ALL_ENV, rt);
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;
    const s = await status(deps);
    expect(s.job.jobId).toBe(ap.jobId);
    expect(s.text).toMatch(new RegExp(`Job ${ap.jobId}: payment=pending`));
  });
});

describe('autopilot-answer — commercial status routing', () => {
  test('status questions answer read-only; advance questions still advance', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, ALL_ENV, fakeRuntime());

    // Read-only: "what are we working on" must not create the goal.
    const a = await tryAutopilotAnswer('what are we working on', deps);
    expect(a.text).toMatch(/COMMERCIAL STATUS/);
    expect((await deps.goals.listGoals()).length).toBe(0);

    // "why this opportunity" after a run — rationale from durable state.
    await advance(deps);
    const b = await tryAutopilotAnswer('why this opportunity', deps);
    expect(b.text).toMatch(/Why this one:/);

    // Advance intent still mutates via brief().
    const c = await tryAutopilotAnswer('next best action', deps);
    expect(c.text).toMatch(/NEXT BEST ACTION/);

    // Non-commercial → null (falls through to other answerers).
    expect(await tryAutopilotAnswer('what time is it', deps)).toBeNull();
  });

  test('status pattern matching is precise', () => {
    expect(looksLikeStatusQuestion('what is waiting for payment')).toBe(true);
    expect(looksLikeStatusQuestion('why are we working on this')).toBe(true);
    expect(looksLikeStatusQuestion('what jobs are executing')).toBe(true);
    expect(looksLikeStatusQuestion('what has been delivered')).toBe(true);
    expect(looksLikeStatusQuestion('hello')).toBe(false);
  });
});

describe('resume', () => {
  test('resumeForPayment resumes only the mission parked on that job', async () => {
    const store = fakeStore([PHILIPS]);
    const rt = fakeRuntime();
    const deps = depsFor(store, ALL_ENV, rt);

    // No objective goal → nothing to resume, returns null, creates nothing.
    expect(await resumeForPayment(deps.goals, 'job_x', deps)).toBeNull();
    expect((await deps.goals.listGoals()).length).toBe(0);

    // Park at payment.
    const r1 = await advance(deps);
    const ap = (await deps.goals.getGoal(r1.goalId)).context.autopilot;

    // A payment for a DIFFERENT job never disturbs the mission.
    expect(await resumeForPayment(deps.goals, 'job_unrelated', deps)).toBeNull();

    // The webhook lands for the mission's own job → resume to proof.
    rt.jobs.get(ap.jobId).paymentStatus = 'paid';
    rt.jobs.get(ap.jobId).paymentIntentId = 'pi_test_1';
    rt.jobs.get(ap.jobId).jobStatus = 'queued';
    const report = await resumeForPayment(deps.goals, ap.jobId, deps);
    expect(report.stage).toBe('TEST_PIPELINE_PROVEN');
  });
});

describe('production readiness (status surface)', () => {
  // Isolated store per test — production boundary actions are durable and
  // must not leak between cases.
  let savedFile;
  beforeEach(() => {
    savedFile = process.env.HYDI_HUMAN_ACTIONS_FILE;
    process.env.HYDI_HUMAN_ACTIONS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-raprod-')), 'human-actions.json');
  });
  afterEach(() => { process.env.HYDI_HUMAN_ACTIONS_FILE = savedFile; });

  test('status() reports production blockers from durable actions — read-only', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, ALL_ENV, fakeRuntime());
    deps.stripeMode = 'test';
    // Materialize a production boundary the way the detector does.
    deps.service.request({
      blockerKey: 'stripe:live-credential',
      title: 'Provide a live Stripe credential for production revenue',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'stripe', capability: 'revenue.production' },
      verifier: { name: 'stripe-live-credential', spec: {} },
    });
    const s = await status(deps);
    expect(s.production).toBeTruthy();
    expect(s.production.ready).toBe(false);
    expect(s.production.mode).toBe('test');
    expect(s.production.blockers.map((b) => b.blockerKey)).toContain('stripe:live-credential');
    expect(s.production.blockers[0].verifier).toBe('stripe-live-credential');
    expect(s.text).toMatch(/NOT READY/);
    expect(s.text).toMatch(/stripe mode: test/);
    // read-only: no goal created, no advance
    expect((await deps.goals.listGoals()).length).toBe(0);
  });

  test('status() reports READY only in live mode with zero open production boundaries', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, ALL_ENV, fakeRuntime());
    deps.stripeMode = 'live';
    const s = await status(deps);
    expect(s.production.ready).toBe(true);
    expect(s.text).toMatch(/READY/);
    // an open production boundary kills readiness even in live mode
    deps.service.request({
      blockerKey: 'stripe:live-webhook-endpoint',
      title: 'Configure the live Stripe webhook endpoint',
      type: 'credential',
      verifier: { name: 'stripe-live-webhook-endpoint', spec: {} },
    });
    const s2 = await status(deps);
    expect(s2.production.ready).toBe(false);
    expect(s2.production.blockers[0].blockerKey).toBe('stripe:live-webhook-endpoint');
  });

  test('implicit blocker: test mode with no materialized actions still reports NOT READY', async () => {
    const store = fakeStore([PHILIPS]);
    const deps = depsFor(store, ALL_ENV, fakeRuntime());
    deps.stripeMode = 'test';
    const s = await status(deps);
    expect(s.production.ready).toBe(false);
    expect(s.production.implicitBlocker).toMatch(/test mode/);
  });
});
