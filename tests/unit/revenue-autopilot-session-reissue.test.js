'use strict';

/**
 * Regression: the revenue autopilot parked forever on an expired checkout
 * session — ensureCheckoutJob returned the job for ap.jobId without ever
 * checking session liveness, and the parked branch returned before the
 * checkout seam ran. The payment Human Action pointed at a dead URL and
 * job-payment-status could never pass.
 *
 * These tests prove:
 *   - a dead session is reissued through the same governed seam (bounded)
 *   - the parked branch heals before re-parking — instructions refresh
 *     via attachBlockerToGoal's amendSpec, no duplicate job is created
 *   - live sessions, paid jobs, live mode, and the reissue cap never reissue
 *   - the public-base-url verifier/detector probe /api/ping (the ingress
 *     gate intentionally 404s `/` for public requests)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { reissueDeadCheckoutSession, advance, MAX_SESSION_REISSUES } = require('../../lib/revenue/revenue-autopilot.js');
const { HumanActionService } = require('../../lib/human-actions/service.js');
const { runVerifier } = require('../../lib/human-actions/verifiers.js');
const { detectStaleBaseUrl } = require('../../lib/human-actions/detector.js');

let dir;
let storeFile;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-reissue-'));
  storeFile = path.join(dir, 'actions.json');
  process.env.HYDI_HUMAN_ACTIONS_FILE = storeFile;
});
afterEach(() => {
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const job = (over = {}) => ({
  jobId: 'job_x',
  paymentStatus: 'pending',
  jobStatus: 'created',
  deliveryStatus: 'pending',
  customerEmail: 't@example.test',
  customerName: 't',
  product: 'protoforge_model_prep',
  priceCents: 2900,
  ...over,
});

const baseAp = () => ({
  stage: 'payment', jobId: 'job_x', offerId: 'protoforge_model_prep',
  offerName: 'Model Prep', priceCents: 2900, currency: 'usd',
  checkoutSessionId: 'cs_old', checkoutUrl: 'https://dead.example',
  steps: [], paymentParked: true,
});

const bridgeOf = (states, createImpl) => ({
  getCheckoutSessionState: jest.fn(async (id) => states[id] || { status: 'open', paymentStatus: 'unpaid', expiresAt: Date.now() / 1000 + 86000 }),
  createSetupCheckoutSession: jest.fn(createImpl || (async () => ({ sessionId: 'cs_new', url: 'https://new.example' }))),
});

describe('reissueDeadCheckoutSession', () => {
  test('expired session → reissue through the governed seam, relink job, update ap', async () => {
    const ap = baseAp();
    const jm = { linkCheckoutSession: jest.fn(async () => { }) };
    const bridge = bridgeOf({ cs_old: { status: 'expired', paymentStatus: 'unpaid', expiresAt: 1 } });
    const notes = [];
    const r = await reissueDeadCheckoutSession({ ap, job: job(), jm, deps: { stripeBridge: bridge, baseUrl: 'https://pub.example' }, mode: 'test', note: async (s, d) => notes.push(`${s}: ${d}`) });
    expect(r.reissued).toBe(true);
    expect(bridge.createSetupCheckoutSession).toHaveBeenCalledTimes(1);
    expect(bridge.createSetupCheckoutSession.mock.calls[0][0]).toMatchObject({ offerId: 'protoforge_model_prep', customerEmail: 't@example.test' });
    expect(jm.linkCheckoutSession).toHaveBeenCalledWith('job_x', 'cs_new', 'https://new.example');
    expect(ap.checkoutSessionId).toBe('cs_new');
    expect(ap.checkoutUrl).toBe('https://new.example');
    expect(ap.sessionReissues).toBe(1);
    expect(ap.paymentParked).toBe(false);
    expect(notes[0]).toMatch(/reissued cs_new/);
  });

  test('live session → no reissue', async () => {
    const ap = baseAp();
    const jm = { linkCheckoutSession: jest.fn() };
    const bridge = bridgeOf({ cs_old: { status: 'open', paymentStatus: 'unpaid', expiresAt: Date.now() / 1000 + 80000 } });
    const r = await reissueDeadCheckoutSession({ ap, job: job(), jm, deps: { stripeBridge: bridge }, mode: 'test' });
    expect(r).toBeNull();
    expect(bridge.createSetupCheckoutSession).not.toHaveBeenCalled();
    expect(ap.checkoutSessionId).toBe('cs_old');
  });

  test('paid job → no reissue', async () => {
    const ap = baseAp();
    const bridge = bridgeOf({});
    const r = await reissueDeadCheckoutSession({ ap, job: job({ paymentStatus: 'paid' }), jm: {}, deps: { stripeBridge: bridge }, mode: 'test' });
    expect(r).toBeNull();
    expect(bridge.getCheckoutSessionState).not.toHaveBeenCalled();
  });

  test('live mode → never reissues autonomously', async () => {
    const ap = baseAp();
    const bridge = bridgeOf({ cs_old: { status: 'expired', paymentStatus: 'unpaid', expiresAt: 1 } });
    const r = await reissueDeadCheckoutSession({ ap, job: job(), jm: {}, deps: { stripeBridge: bridge }, mode: 'live' });
    expect(r).toBeNull();
    expect(bridge.getCheckoutSessionState).not.toHaveBeenCalled();
  });

  test('reissue cap → refuses to mint another session', async () => {
    const ap = { ...baseAp(), sessionReissues: MAX_SESSION_REISSUES };
    const bridge = bridgeOf({ cs_old: { status: 'expired', paymentStatus: 'unpaid', expiresAt: 1 } });
    const r = await reissueDeadCheckoutSession({ ap, job: job(), jm: {}, deps: { stripeBridge: bridge }, mode: 'test', note: async () => { } });
    expect(r.capped).toBe(true);
    expect(bridge.createSetupCheckoutSession).not.toHaveBeenCalled();
    expect(ap.checkoutSessionId).toBe('cs_old');
  });
});

describe('parked advance() — dispatch gap regression', () => {
  const makeGoal = () => ({
    goalId: 'goal_1', title: 'REVENUE AUTOPILOT', status: 'escalated', goalType: 'mission', priority: 9,
    context: {
      autopilotObjective: true, managedBy: 'revenue-autopilot', waitingOnHuman: true,
      humanActions: [], autopilot: baseAp(),
    },
    evidence: [], createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  });

  const goalsOf = (goal) => {
    const writes = [];
    return {
      writes,
      getGoal: jest.fn(async () => goal),
      updateGoal: jest.fn(async (id, upd) => {
        if (upd.context) goal.context = upd.context;
        if (upd.status) goal.status = upd.status;
        if (upd.evidence) goal.evidence = [...goal.evidence, ...upd.evidence];
        writes.push(upd);
        return goal;
      }),
      listGoals: jest.fn(async () => [goal]),
    };
  };

  test('parked on dead session → reissues, refreshes action URL, stays parked, creates no duplicate job', async () => {
    const goal = makeGoal();
    const goals = goalsOf(goal);
    const jm = {
      getJob: jest.fn(async () => job()),
      linkCheckoutSession: jest.fn(async () => { }),
      createJob: jest.fn(async () => { throw new Error('duplicate job creation — must never happen'); }),
    };
    const states = {
      cs_old: { status: 'expired', paymentStatus: 'unpaid', expiresAt: 1 },
      cs_new: { status: 'open', paymentStatus: 'unpaid', expiresAt: Date.now() / 1000 + 86000 },
    };
    const bridge = bridgeOf(states);
    const svc = new HumanActionService({ verifierDeps: { jobManager: jm, envNamePresent: () => true } });
    // Pre-seed the parked payment action the way a prior pass created it —
    // instructions carry the DEAD checkout url.
    const seeded = svc.request({
      blockerKey: 'revenue:payment:job_x', title: 'Complete test checkout payment — protoforge_model_prep (2900¢)',
      instructions: ['Open the checkout URL and complete payment: https://dead.example', 'Tell Heidi "check again"'],
      verifier: { name: 'job-payment-status', spec: { jobId: 'job_x' } },
      sourceGoalId: 'goal_1', context: { mission: 'revenue-autopilot', blocker: 'PAYMENT_PENDING' },
    });
    goal.context.humanActions = [seeded.action.id];

    const deps = {
      goals, service: svc, jobManager: jm, stripeBridge: bridge,
      opportunityStore: { listOpportunities: async () => [], getOpportunity: async () => null },
      envNamePresent: () => true, stripeMode: 'test', baseUrl: 'https://pub.example',
      actor: 'test',
    };

    const r1 = await advance(deps);
    expect(r1.stage).toBe('WAITING_ON_HUMAN');
    expect(bridge.createSetupCheckoutSession).toHaveBeenCalledTimes(1);
    expect(jm.createJob).not.toHaveBeenCalled();
    expect(jm.linkCheckoutSession).toHaveBeenCalledWith('job_x', 'cs_new', 'https://new.example');
    expect(goal.context.autopilot.checkoutSessionId).toBe('cs_new');
    expect(goal.context.autopilot.sessionReissues).toBe(1);
    expect(goal.status).toBe('escalated'); // still parked — reissue is not payment

    // The parked action's instructions self-healed to the fresh URL via amendSpec.
    const a = svc.get(seeded.action.id);
    expect(a.instructions.join(' ')).toContain('https://new.example');
    expect(a.instructions.join(' ')).not.toContain('https://dead.example');

    // Second pass: session is live now — no further reissue, no duplication.
    const r2 = await advance(deps);
    expect(r2.stage).toBe('WAITING_ON_HUMAN');
    expect(bridge.createSetupCheckoutSession).toHaveBeenCalledTimes(1);
    expect(jm.createJob).not.toHaveBeenCalled();
    expect(goal.context.autopilot.sessionReissues).toBe(1);
  });
});

describe('http-reachable probePath + stale-base-url detection (ingress-gate regression)', () => {
  test('verifier probes spec.probePath, not the bare origin', async () => {
    const seen = [];
    const fetch = jest.fn(async (u) => { seen.push(u); return { ok: u.endsWith('/api/ping'), status: u.endsWith('/api/ping') ? 200 : 404 }; });
    const r = await runVerifier('http-reachable', { url: 'https://pub.example', probePath: '/api/ping' }, { fetch });
    expect(seen[0]).toBe('https://pub.example/api/ping');
    expect(r.passed).toBe(true);
  });

  test('bare-origin 404 + /api/ping 200 → URL is NOT stale (gate working as designed)', async () => {
    const fetch = jest.fn(async (u) => ({ ok: u.endsWith('/api/ping'), status: u.endsWith('/api/ping') ? 200 : 404, json: async () => ({ tunnels: [] }) }));
    const svc = new HumanActionService({});
    const env = { envNamePresent: (n) => n === 'NEXT_PUBLIC_APP_URL', envValue: () => 'https://pub.example' };
    const r = await detectStaleBaseUrl(svc, env, { fetch, confirmAttempts: 1 });
    expect(r.checked).toBe(true);
    expect(r.stale).toBe(false);
  });

  test('minted action spec carries probePath so re-verification checks the same endpoint', async () => {
    const fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    const svc = new HumanActionService({});
    const env = { envNamePresent: () => true, envValue: () => 'https://down.example' };
    const r = await detectStaleBaseUrl(svc, env, { fetch, confirmAttempts: 1 });
    expect(r.stale).toBe(true);
    const a = svc.get(r.actionId);
    expect(a.verifier).toMatchObject({ name: 'http-reachable', spec: { urlEnv: 'NEXT_PUBLIC_APP_URL', probePath: '/api/ping' } });
  });

  test('an open action seeded before probePath existed gets its spec amended — even when detection no longer trips', async () => {
    const svc = new HumanActionService({});
    const env = { envNamePresent: () => true, envValue: () => 'https://down.example' };
    const r1 = await detectStaleBaseUrl(svc, env, { fetch: jest.fn(async () => ({ ok: false, status: 503 })), confirmAttempts: 1 });
    // Simulate a pre-probePath record, as production had after the gate deployed.
    svc.amendSpec(r1.actionId, { verifier: { name: 'http-reachable', spec: { urlEnv: 'NEXT_PUBLIC_APP_URL' } }, actor: 'test' });
    // URL is now healthy — the early-return path must still reconcile the spec.
    const healthy = jest.fn(async (u) => ({ ok: u.endsWith('/api/ping'), status: 200, json: async () => ({ tunnels: [] }) }));
    const r2 = await detectStaleBaseUrl(svc, env, { fetch: healthy, confirmAttempts: 1 });
    expect(r2.stale).toBe(false);
    const a = svc.get(r1.actionId);
    expect(a.verifier.spec.probePath).toBe('/api/ping');
    expect(a.transitions.some(t => t.type === 'SPEC_AMENDED')).toBe(true);
  });
});
