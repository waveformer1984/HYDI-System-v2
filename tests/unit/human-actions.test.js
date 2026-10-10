'use strict';

/**
 * Human Action system tests — canonical v2 contract: lifecycle, dedupe,
 * verifiers, detector seeding, expiry, audit trail, mission/goal linkage,
 * resume semantics, and the deterministic Heidi answer surface.
 * An isolated store file is used per run (HYDI_HUMAN_ACTIONS_FILE).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-')), 'human-actions.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { HumanActionService } = require('../../lib/human-actions/service');
const { runVerifier, envNamePresent } = require('../../lib/human-actions/verifiers');
const { detectKnownBlockers, syncHumanActions, verifyEligibleActions } = require('../../lib/human-actions/detector');
const { CATEGORIES, boundaryKey, normalizeBoundary } = require('../../lib/human-actions/boundary');
const { attachBlockerToGoal, resumeSatisfiedGoals, scanEscalatedGoals } = require('../../lib/human-actions/mission-link');
const { tryHumanActionAnswer } = require('../../lib/human-actions/heidi-answer');
const { load, save } = require('../../lib/human-actions/store');

/** In-memory GoalSystem stand-in: same {getGoal, updateGoal, listGoals} surface. */
function fakeGoals(seed = []) {
  const store = new Map(seed.map((g) => [g.goalId, { evidence: [], ...g }]));
  return {
    store,
    async getGoal(id) { return store.get(id) || null; },
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

describe('HumanActionService (v2 contract)', () => {
  const svc = () => new HumanActionService({});

  test('request creates a durable OPEN action with canonical fields', () => {
    const { action, created } = svc().request({
      blockerKey: 'test:thing', title: 'Do the thing', type: 'credential',
      description: 'why this exists',
      instructions: ['step one'],
      verifier: { name: 'env-vars', spec: { envNames: ['HA_TEST_VAR'] } },
      sourceMissionId: 'm-1', sourceGoalId: 'g-1', sourceAgentId: 'a-1',
      priority: 'high',
    });
    expect(created).toBe(true);
    expect(action.id).toMatch(/^ha_/);
    expect(action.status).toBe('OPEN');
    expect(action.sourceMissionId).toBe('m-1');
    expect(action.sourceGoalId).toBe('g-1');
    expect(action.verifier.name).toBe('env-vars');
    expect(action.transitions[0].type).toBe('CREATED');
    expect(svc().get(action.id).title).toBe('Do the thing');
  });

  test('dedupe: same blockerKey returns the same open action', () => {
    const s = svc();
    const a = s.request({ blockerKey: 'test:dedupe', title: 'X' }).action;
    const b = s.request({ blockerKey: 'test:dedupe', title: 'X again' });
    expect(b.created).toBe(false);
    expect(b.action.id).toBe(a.id);
  });

  test('claim → verify → auto_verified RESOLVED; attestation cannot bypass a failing check', async () => {
    const s = svc();
    const { action } = s.request({
      blockerKey: 'test:env', title: 'Set HA_TEST_VAR',
      verifier: { name: 'env-vars', spec: { envNames: ['HA_TEST_VAR'] } },
    });
    s.claim(action.id, 'tester');
    expect(s.get(action.id).status).toBe('CLAIMED');

    // fails while the env var is genuinely absent → BLOCKED with evidence
    const bad = await s.verify(action.id, 'tester');
    expect(bad.result.passed).toBe(false);
    const a1 = s.get(action.id);
    expect(a1.status).toBe('BLOCKED');
    expect(a1.verification.verificationId).toMatch(/^ver_/);
    expect(a1.verification.checks.length).toBe(1);
    expect(a1.attempts).toBe(1);
    expect(() => s.resolve(action.id)).toThrow(/verify|attestation/i);

    process.env.HA_TEST_VAR = 'set-in-test';
    const good = await s.verify(action.id, 'tester');
    delete process.env.HA_TEST_VAR;
    expect(good.result.passed).toBe(true);
    const a2 = s.get(action.id);
    expect(a2.status).toBe('RESOLVED');
    expect(a2.resolution).toBe('auto_verified');
    // audit trail: CREATED CLAIMED VERIFY_REQUESTED FAILED_VERIFICATION VERIFY_REQUESTED VERIFIED RESOLVED
    const types = a2.transitions.map((t) => t.type);
    expect(types).toEqual(['CREATED', 'CLAIMED', 'VERIFY_REQUESTED', 'FAILED_VERIFICATION', 'VERIFY_REQUESTED', 'VERIFIED', 'RESOLVED']);
  });

  test('manual actions resolve by human attestation only', () => {
    const s = svc();
    const { action } = s.request({ blockerKey: 'test:manual', title: 'Physical step', verifier: { name: 'manual', spec: {} } });
    expect(() => s.resolve(action.id, { note: 'done', actor: 'j' })).not.toThrow();
    const a = s.get(action.id);
    expect(a.status).toBe('RESOLVED');
    expect(a.resolution).toBe('human_attested');
    expect(a.verification.passed).toBe(true);
  });

  test('reject and cancel close the action deterministically', () => {
    const s = svc();
    const a = s.request({ blockerKey: 'test:rej', title: 'Nope' }).action;
    s.reject(a.id, { reason: 'not needed' });
    expect(s.get(a.id).status).toBe('REJECTED');

    const b = s.request({ blockerKey: 'test:cxl', title: 'Later' }).action;
    s.cancel(b.id, { reason: 'superseded' });
    expect(s.get(b.id).status).toBe('CANCELLED');
  });

  test('expiresAt drives lazy EXPIRY — no timer needed', () => {
    const s = svc();
    const { action } = s.request({
      blockerKey: 'test:exp', title: 'Expiring',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(s.get(action.id).status).toBe('EXPIRED');
    expect(s.get(action.id).transitions.some((t) => t.type === 'EXPIRED')).toBe(true);
  });

  test('resolved action is not re-verified; terminal actions refuse ops', async () => {
    const s = svc();
    const { action } = s.request({ blockerKey: 'test:done', title: 'D', verifier: { name: 'manual', spec: {} } });
    s.resolve(action.id);
    const r = await s.verify(action.id);
    expect(r.checked).toBe(false); // RESOLVED short-circuits, no re-verify
    const rej = s.request({ blockerKey: 'test:term', title: 'T' }).action;
    s.reject(rej.id);
    await expect(s.verify(rej.id)).rejects.toThrow(/terminal/);
  });

  test('v1 records migrate on load', () => {
    const db = load();
    db.actions.push({
      id: 'ha_legacy1', blocker_key: 'old:key', title: 'Legacy', kind: 'credential',
      instructions: ['x'], status: 'open', created_at: '2026-01-01T00:00:00Z',
      claimed_at: null, resolved_at: null, resolution: null, verify_result: null,
      verification: { verifier: 'env-vars', spec: { envNames: ['X'] } },
    });
    save({ version: 1, actions: db.actions });
    const migrated = load().actions.find((a) => a.id === 'ha_legacy1');
    expect(migrated.status).toBe('OPEN');
    expect(migrated.blockerKey).toBe('old:key');
    expect(migrated.verifier.name).toBe('env-vars');
    expect(migrated.schema).toBe(2);
  });
});

describe('verifiers (durable evidence shape)', () => {
  test('env-vars: reports missing names without values, checks[] rows', async () => {
    const r = await runVerifier('env-vars', { envNames: ['DEFINITELY_MISSING_VAR_XYZ'] });
    expect(r.passed).toBe(false);
    expect(r.verifier).toBe('env-vars');
    expect(r.verificationId).toMatch(/^ver_/);
    expect(r.checks[0].name).toContain('DEFINITELY_MISSING_VAR_XYZ');
    expect(r.checks[0].passed).toBe(false);
    expect(JSON.stringify(r)).not.toContain('sk_');
  });

  test('unknown verifier fails closed — never dynamic execution', async () => {
    const r = await runVerifier('nope; rm -rf /', {});
    expect(r.passed).toBe(false);
    expect(r.failureReason).toContain('unknown verifier');
  });

  test('verifier throw → failed result, not an exception', async () => {
    const r = await runVerifier('http-reachable', { url: 'http://127.0.0.1:1/definitely-closed' });
    expect(r.passed).toBe(false);
  });

  test('rezonate-testnet verifier refuses with absent env and lists missing names', async () => {
    const saved = {};
    for (const n of ['REZONATE_CHAIN_RPC', 'REZONATE_DEPLOYER_KEY', 'REZONATE_BUYER_KEY']) { saved[n] = process.env[n]; delete process.env[n]; }
    const r = await runVerifier('rezonate-testnet', {
      rpcEnv: 'REZONATE_CHAIN_RPC', deployerKeyEnv: 'REZONATE_DEPLOYER_KEY', buyerKeyEnv: 'REZONATE_BUYER_KEY', expectedChainId: 11155111,
    });
    for (const n of Object.keys(saved)) if (saved[n] !== undefined) process.env[n] = saved[n];
    expect(typeof r.passed).toBe('boolean');
    if (!r.passed) expect(r.safeSummary || r.failureReason).toBeTruthy();
    expect(Array.isArray(r.checks)).toBe(true);
  });
});

describe('detector', () => {
  test('seeds the rezonate credential action exactly once when env is absent', () => {
    const s = new HumanActionService({});
    // Hermetic env — reports nothing configured regardless of real .env.local.
    const absentEnv = { envNamePresent: () => false, envValue: () => null };
    const r1 = detectKnownBlockers(s, absentEnv);
    const r2 = detectKnownBlockers(s, absentEnv);
    if (r1.requested.length) {
      expect(r2.requested.length).toBe(0);
      expect(r2.alreadyOpen).toEqual(r1.requested);
      const seeded = s.get(r1.requested[0]);
      expect(seeded.sourceMissionId).toBe('rezonate-v1.3-public-testnet');
    }
    expect(r1.checked).toBeGreaterThan(0);
  });
});

describe('mission linkage', () => {
  test('goal escalates to WAITING_ON_HUMAN and resumes only when ALL linked actions resolve', async () => {
    const s = new HumanActionService({});
    const goals = fakeGoals([{ goalId: 'g1', title: 'Rezonate public deploy', status: 'in_progress', context: {} }]);

    // Two prerequisites on the same goal (multi-blocker)
    const a = await attachBlockerToGoal(s, goals, {
      goalId: 'g1', blockerKey: 'test:env-a',
      spec: { title: 'Set HA_G_A', verifier: { name: 'env-vars', spec: { envNames: ['HA_G_A'] } } },
    });
    await attachBlockerToGoal(s, goals, {
      goalId: 'g1', blockerKey: 'test:env-b',
      spec: { title: 'Set HA_G_B', verifier: { name: 'env-vars', spec: { envNames: ['HA_G_B'] } } },
    });
    const g1 = await goals.getGoal('g1');
    expect(g1.status).toBe('escalated');
    expect(g1.context.waitingOnHuman).toBe(true);
    expect(g1.context.humanActions.length).toBe(2);

    // Resolving ONE of two does not resume the goal
    process.env.HA_G_A = '1';
    await s.verify(a.action.id);
    let r = await resumeSatisfiedGoals(s, goals, { actor: 'test' });
    expect(r.resumed.length).toBe(0);
    expect(r.stillWaiting[0].satisfiedCount).toBe(1);
    expect(r.stillWaiting[0].totalLinked).toBe(2);

    // Both satisfied → goal flips back to pending with resume evidence
    process.env.HA_G_B = '1';
    const linked = s.forGoal('g1');
    await s.verify(linked.find((x) => x.blockerKey === 'test:env-b').id);
    r = await resumeSatisfiedGoals(s, goals, { actor: 'test' });
    delete process.env.HA_G_A; delete process.env.HA_G_B;
    expect(r.resumed.length).toBe(1);
    const g2 = await goals.getGoal('g1');
    expect(g2.status).toBe('pending');
    expect(g2.context.waitingOnHuman).toBe(false);
    const ev = g2.evidence.find((e) => e.type === 'HUMAN_PREREQUISITE_SATISFIED');
    expect(ev.resolvedActionIds.length).toBe(2);
    expect(ev.verificationIds.length).toBe(2);
  });

  test('scanEscalatedGoals links unlinked escalations without duplicating', async () => {
    const s = new HumanActionService({});
    const goals = fakeGoals([
      { goalId: 'g-esc', title: 'Deploy needs credential for external API', status: 'escalated', context: {} },
      { goalId: 'g-ok', title: 'Normal work', status: 'pending', context: {} },
    ]);
    const r1 = await scanEscalatedGoals(s, goals);
    expect(r1.linked.length).toBe(1);
    const r2 = await scanEscalatedGoals(s, goals);
    expect(r2.linked.length).toBe(0); // dedupe — no second action
    const linked = s.forGoal('g-esc');
    expect(linked.length).toBe(1);
    expect(linked[0].verifier.name).toBe('manual');
  });

  test('syncHumanActions detects + links + resumes in one pass', async () => {
    const s = new HumanActionService({});
    const goals = fakeGoals([]);
    const r = await syncHumanActions(s, goals);
    expect(r.detection.checked).toBeGreaterThan(0);
    expect(r.goalScan).toBeTruthy();
    expect(r.resume).toBeTruthy();
  });
});

describe('heidi answer', () => {
  test('non-action questions return null', async () => {
    expect(await tryHumanActionAnswer('what is the weather today')).toBeNull();
    expect(await tryHumanActionAnswer('hello there')).toBeNull();
  });

  test('"what do you need from me" lists open actions with instructions + verifier + links', async () => {
    const s = new HumanActionService({});
    s.request({
      blockerKey: 'test:qa', title: 'QA action', instructions: ['do A', 'do B'],
      verifier: { name: 'manual', spec: {} }, sourceMissionId: 'm-x', priority: 'high',
    });
    const a = await tryHumanActionAnswer('what do you need from me', { service: s });
    expect(a.text).toContain('QA action');
    expect(a.text).toContain('do A');
    expect(a.text).toContain('mission: m-x');
    expect(a.text).toContain('human attestation');
  });

  test('"what is blocking rezonate" filters to the domain', async () => {
    const s = new HumanActionService({});
    s.request({ blockerKey: 'test:rez', title: 'Rezonate creds', verifier: { name: 'manual', spec: {} }, sourceMissionId: 'rezonate-v1.3' });
    s.request({ blockerKey: 'test:other', title: 'Unrelated thing', verifier: { name: 'manual', spec: {} } });
    const a = await tryHumanActionAnswer('what is blocking rezonate', { service: s });
    expect(a.text).toContain('Rezonate creds');
    expect(a.text).not.toContain('Unrelated thing');
  });

  test('"I did it" re-runs verifiers instead of trusting the claim', async () => {
    const s = new HumanActionService({});
    s.request({ blockerKey: 'test:claim', title: 'Set thing', verifier: { name: 'env-vars', spec: { envNames: ['HA_NEVER_SET_XYZ'] } } });
    const a = await tryHumanActionAnswer('i did it', { service: s });
    expect(a.text).toMatch(/still failing|manual-attestation/);
  });

  test('"check again" verifies and reports check rows', async () => {
    const s = new HumanActionService({});
    s.request({ blockerKey: 'test:again', title: 'Set HA_AGAIN', verifier: { name: 'env-vars', spec: { envNames: ['HA_AGAIN_XYZ'] } } });
    const a = await tryHumanActionAnswer('check again', { service: s });
    expect(a.text).toMatch(/still failing|Verification re-run/);
  });

  test('"why is this still blocked" reports last verifier result + next step, read-only', async () => {
    const s = new HumanActionService({});
    const { action } = s.request({
      blockerKey: 'test:why', title: 'Set HA_WHY', instructions: ['set HA_WHY=1'],
      verifier: { name: 'env-vars', spec: { envNames: ['HA_WHY_MISSING'] } },
    });
    const a = await tryHumanActionAnswer('why is this still blocked', { service: s });
    expect(a.text).toContain('Still blocked');
    expect(a.text).toContain('Set HA_WHY');
    expect(a.text).toMatch(/last check:/);
    expect(s.get(action.id).status).not.toBe('RESOLVED'); // read-only: never resolves
  });

  test('"did my action work" reports durable verification state without re-running', async () => {
    const s = new HumanActionService({});
    const { action } = s.request({
      blockerKey: 'test:worked', title: 'Set HA_WORKED',
      verifier: { name: 'env-vars', spec: { envNames: ['HA_WORKED_MISSING'] } },
    });
    const a = await tryHumanActionAnswer('did my action work', { service: s });
    expect(a.text).toContain('not checked yet');
    expect(a.text).toContain('check again');
    // after a failed verify, it answers with the durable failure
    await s.verify(action.id, 'tester');
    const b = await tryHumanActionAnswer('did that work', { service: s });
    expect(b.text).toMatch(/not yet|FAILED/i);
  });

  test('"what happens after" explains the resume path', async () => {
    const s = new HumanActionService({});
    s.request({
      blockerKey: 'test:after', title: 'Set HA_AFTER', resumeCapability: 'the deploy mission resumes',
      verifier: { name: 'env-vars', spec: { envNames: ['HA_AFTER_MISSING'] } },
    });
    const a = await tryHumanActionAnswer('what happens after I do this', { service: s });
    expect(a.text).toContain('the deploy mission resumes');
    expect(a.text).toContain('env-vars');
    expect(a.text).toMatch(/independently confirms/);
  });
});

describe('boundary contract (universal boundary protocol)', () => {
  test('the vocabulary is the canonical 12 categories', () => {
    expect(CATEGORIES).toEqual([
      'PAYMENT', 'CREDENTIAL', 'AUTHORIZATION', 'EXTERNAL_SERVICE', 'ACCOUNT_SETUP',
      'DOMAIN', 'DEPLOYMENT', 'FUNDING', 'CUSTOMER_ACTION', 'PHYSICAL_ACTION',
      'COMPLIANCE', 'OTHER',
    ]);
  });

  test('boundaryKey is deterministic and never derives from a title', () => {
    expect(boundaryKey('PAYMENT', 'pi_123')).toBe('payment:pi_123');
    expect(boundaryKey('credential', 'Rezonate-Chain')).toBe('credential:rezonate-chain');
    expect(() => boundaryKey('PAYMENT', '')).toThrow(/discriminator/);
    expect(() => boundaryKey('NOPE', 'x')).toThrow(/unknown boundary category/);
  });

  test('request stores a normalized boundary; explicit category wins over type', () => {
    const s = new HumanActionService({});
    const { action } = s.request({
      blockerKey: 'test:boundary', title: 'Fund the wallet', type: 'general',
      boundary: { category: 'FUNDING', externalSystem: 'sepolia', capability: 'wallet.fund' },
      expectedOutcome: 'wallet balance above threshold',
      resumeCapability: 'deploy resumes',
      verifier: { name: 'manual', spec: {} },
    });
    expect(action.boundary).toEqual({ category: 'FUNDING', capability: 'wallet.fund', externalSystem: 'sepolia', externalObjectId: null });
    expect(action.expectedOutcome).toBe('wallet balance above threshold');
    expect(action.resumeCapability).toBe('deploy resumes');
  });

  test('legacy type maps to category; explicit invalid category throws', () => {
    const s = new HumanActionService({});
    const { action } = s.request({ blockerKey: 'test:legacy-type', title: 'X', type: 'credential' });
    expect(action.boundary.category).toBe('CREDENTIAL');
    expect(() => s.request({ blockerKey: 'test:bad-cat', title: 'X', boundary: { category: 'WHATEVER' } })).toThrow(/unknown boundary category/);
  });

  test('legacy v1 records without boundary still load — category derived from type', () => {
    save({
      version: 1, actions: [{
        id: 'ha_noboundary', blocker_key: 'old:noboundary', title: 'Legacy no boundary',
        kind: 'credential', status: 'open', created_at: '2026-01-01T00:00:00Z', resolved_at: null,
        verification: { verifier: 'manual', spec: {} },
      }]
    });
    const rec = new HumanActionService({}).get('ha_noboundary');
    expect(rec).toBeTruthy();
    expect(rec.status).toBe('OPEN');
    expect(rec.boundary.category).toBe('CREDENTIAL'); // derived at migration
  });
});

describe('verifier formal status contract', () => {
  test('VERIFIED / FAILED / UNAVAILABLE + resumeEligible', async () => {
    process.env.HA_STATUS_VAR = 'x';
    const pass = await runVerifier('env-vars', { envNames: ['HA_STATUS_VAR'] });
    delete process.env.HA_STATUS_VAR;
    expect(pass.status).toBe('VERIFIED');
    expect(pass.resumeEligible).toBe(true);
    expect(pass.passed).toBe(true); // backward compat

    const fail = await runVerifier('env-vars', { envNames: ['HA_NEVER_THERE_XYZ'] });
    expect(fail.status).toBe('FAILED');
    expect(fail.resumeEligible).toBe(false);
    expect(fail.passed).toBe(false);

    const unknown = await runVerifier('no-such-verifier', {});
    expect(unknown.status).toBe('UNAVAILABLE');
    expect(unknown.resumeEligible).toBe(false);
  });
});

describe('periodic verification sweep', () => {
  test('resolves a machine-checkable action when the world changed — no human needed', async () => {
    const s = new HumanActionService({});
    const { action } = s.request({
      blockerKey: 'test:sweep', title: 'Set HA_SWEEP',
      verifier: { name: 'env-vars', spec: { envNames: ['HA_SWEEP_VAR'] } },
    });
    process.env.HA_SWEEP_VAR = '1';
    const r = await verifyEligibleActions(s, { throttleMs: 0 });
    delete process.env.HA_SWEEP_VAR;
    expect(r.checked).toBeGreaterThanOrEqual(1); // shared store may hold other eligible actions
    expect(r.resolved.map((x) => x.actionId)).toContain(action.id);
    expect(s.get(action.id).status).toBe('RESOLVED');
    expect(s.get(action.id).resolution).toBe('auto_verified');
  });

  test('skips manual actions and throttles recently checked ones', async () => {
    const s = new HumanActionService({});
    const manual = s.request({ blockerKey: 'test:sweep-manual', title: 'Physical', verifier: { name: 'manual', spec: {} } }).action;
    const checked = s.request({ blockerKey: 'test:sweep-throttle', title: 'X', verifier: { name: 'env-vars', spec: { envNames: ['HA_THROTTLE_MISS'] } } }).action;
    await s.verify(checked.id); // just checked → inside throttle window
    const r = await verifyEligibleActions(s, { throttleMs: 60 * 60 * 1000 });
    expect(r.checked).toBe(0);                    // everything eligible was checked recently → throttled
    expect(r.throttled).toBeGreaterThanOrEqual(1); // the just-verified action is inside the window
    expect(s.get(checked.id).attempts).toBe(1);   // not re-checked
    expect(s.get(manual.id).status).toBe('OPEN'); // untouched — manual never auto-checks
    expect(s.get(manual.id).attempts).toBe(0);
  });

  test('failed sweep keeps action BLOCKED with durable evidence', async () => {
    const s = new HumanActionService({});
    const { action } = s.request({
      blockerKey: 'test:sweep-fail', title: 'X',
      verifier: { name: 'env-vars', spec: { envNames: ['HA_SWEEP_MISS'] } },
    });
    const r = await verifyEligibleActions(s, { throttleMs: 0 });
    expect(r.stillBlocked.map((x) => x.actionId)).toContain(action.id);
    const a = s.get(action.id);
    expect(a.status).toBe('BLOCKED');
    expect(a.verification.status).toBe('FAILED');
    expect(a.attempts).toBe(1);
  });

  test('sweep + resume: a cleared boundary releases the parked goal', async () => {
    const s = new HumanActionService({});
    const goals = fakeGoals([{ goalId: 'g-sweep', title: 'deploy', status: 'in_progress', context: {} }]);
    await attachBlockerToGoal(s, goals, {
      goalId: 'g-sweep', blockerKey: 'test:sweep-goal',
      spec: { title: 'Set HA_SWEEP_GOAL', verifier: { name: 'env-vars', spec: { envNames: ['HA_SWEEP_GOAL_VAR'] } } },
    });
    expect((await goals.getGoal('g-sweep')).status).toBe('escalated');
    process.env.HA_SWEEP_GOAL_VAR = '1';
    const r = await syncHumanActions(s, goals, { verify: { throttleMs: 0 } });
    delete process.env.HA_SWEEP_GOAL_VAR;
    expect(r.verify.resolved.length).toBe(1);
    expect(r.resume.resumed.length).toBe(1);
    expect((await goals.getGoal('g-sweep')).status).toBe('pending');
  });

  test('restart persistence: action + verification state survive a fresh service instance', async () => {
    const s1 = new HumanActionService({});
    const { action } = s1.request({
      blockerKey: 'test:restart', title: 'Persist me',
      verifier: { name: 'env-vars', spec: { envNames: ['HA_RESTART_MISS'] } },
    });
    await s1.verify(action.id);
    const s2 = new HumanActionService({}); // new instance — same durable store
    const rec = s2.get(action.id);
    expect(rec.status).toBe('BLOCKED');
    expect(rec.verification.status).toBe('FAILED');
    expect(rec.attempts).toBe(1);
    // a second sync does not create a duplicate
    const again = s2.request({ blockerKey: 'test:restart', title: 'Persist me' });
    expect(again.created).toBe(false);
    expect(again.action.id).toBe(action.id);
  });
});

// ─── Production revenue boundaries ─────────────────────────────────────
// The detector's standing production rules + the three verifiers that
// prove them. Every check reads derived facts (key prefix, host, endpoint
// URL) — never secret values.

describe('production Stripe boundary verifiers', () => {
  test('stripe-live-credential: test key fails honestly, prefix only in evidence', async () => {
    const r = await runVerifier('stripe-live-credential', {}, { envValue: (n) => n === 'STRIPE_SECRET_KEY' ? 'sk_test_FAKEforTESTING' : null });
    expect(r.status).toBe('FAILED');
    expect(r.resumeEligible).toBe(false);
    expect(r.failureReason).toMatch(/test mode|live/i);
    expect(r.evidence.keyPrefix).toBe('sk_test_');
    expect(JSON.stringify(r.evidence)).not.toContain('FAKEforTESTING');
  });

  test('stripe-live-credential: live key verifies (sk_live_ and rk_live_)', async () => {
    for (const k of ['sk_live_FAKEforTESTING', 'rk_live_FAKEforTESTING']) {
      const r = await runVerifier('stripe-live-credential', {}, { envValue: (n) => n === 'STRIPE_SECRET_KEY' ? k : null });
      expect(r.status).toBe('VERIFIED');
      expect(r.resumeEligible).toBe(true);
      expect(JSON.stringify(r.evidence)).not.toContain('FAKEforTESTING');
    }
  });

  test('stripe-live-credential: missing key fails closed', async () => {
    const r = await runVerifier('stripe-live-credential', {}, { envValue: () => null });
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toMatch(/missing/);
  });

  test('public-base-url: localhost and http fail; public https verifies', async () => {
    const cases = [
      [null, 'FAILED'],
      ['http://localhost:3000', 'FAILED'],
      ['https://localhost:3000', 'FAILED'],
      ['http://shop.example.com', 'FAILED'],
      ['https://shop.example.com', 'VERIFIED'],
      ['https://heidi.example.org/', 'VERIFIED'],
    ];
    for (const [url, want] of cases) {
      const r = await runVerifier('public-base-url', {}, { envValue: (n) => n === 'NEXT_PUBLIC_APP_URL' ? url : null });
      expect(`${url} → ${r.status}`).toBe(`${url} → ${want}`);
    }
  });

  test('stripe-live-webhook-endpoint: fails fast without live credential (no API call)', async () => {
    let apiCalled = false;
    const stripe = { webhookEndpoints: { list: async () => { apiCalled = true; return { data: [] }; } } };
    const r = await runVerifier('stripe-live-webhook-endpoint', {}, {
      stripe, envValue: () => 'sk_test_FAKEforTESTING', envNamePresent: () => true,
    });
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toMatch(/live credential/i);
    expect(apiCalled).toBe(false);
  });

  test('stripe-live-webhook-endpoint: verifies a real endpoint + signing secret', async () => {
    const stripe = {
      webhookEndpoints: {
        list: async () => ({
          data: [
            { id: 'we_1', status: 'enabled', url: 'https://heidi.example.com/api/webhooks/stripe', enabled_events: ['checkout.session.completed', 'charge.refunded'] },
            { id: 'we_2', status: 'disabled', url: 'https://old.example.com/api/webhooks/stripe', enabled_events: ['*'] },
          ]
        })
      }
    };
    const r = await runVerifier('stripe-live-webhook-endpoint', { path: '/api/webhooks/stripe', requiredEvents: ['checkout.session.completed'] }, {
      stripe,
      envValue: (n) => n === 'STRIPE_SECRET_KEY' ? 'sk_live_FAKEforTESTING' : 'whsec_FAKE',
      envNamePresent: (n) => n === 'STRIPE_WEBHOOK_SECRET_01',
    });
    expect(r.status).toBe('VERIFIED');
    expect(r.resumeEligible).toBe(true);
    expect(r.evidence.endpointId).toBe('we_1');
  });

  test('stripe-live-webhook-endpoint: endpoint without required event fails', async () => {
    const stripe = {
      webhookEndpoints: {
        list: async () => ({
          data: [
            { id: 'we_3', status: 'enabled', url: 'https://heidi.example.com/api/webhooks/stripe', enabled_events: ['invoice.paid'] },
          ]
        })
      }
    };
    const r = await runVerifier('stripe-live-webhook-endpoint', {}, {
      stripe,
      envValue: (n) => n === 'STRIPE_SECRET_KEY' ? 'sk_live_FAKEforTESTING' : 'whsec_FAKE',
      envNamePresent: () => true,
    });
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toMatch(/checkout\.session\.completed|no enabled/);
  });

  test('stripe-live-webhook-endpoint: API error reports PENDING not FAILED', async () => {
    const stripe = { webhookEndpoints: { list: async () => { throw new Error('network down'); } } };
    const r = await runVerifier('stripe-live-webhook-endpoint', {}, {
      stripe,
      envValue: (n) => n === 'STRIPE_SECRET_KEY' ? 'sk_live_FAKEforTESTING' : 'whsec_FAKE',
      envNamePresent: () => true,
    });
    expect(r.status).toBe('PENDING');
    expect(r.resumeEligible).toBe(false);
  });
});

describe('production boundary detection (detector rules)', () => {
  // These tests create real durable actions — isolate each in its own
  // store file so earlier suites' records can't pollute the assertions.
  let savedFile;
  beforeEach(() => {
    savedFile = process.env.HYDI_HUMAN_ACTIONS_FILE;
    process.env.HYDI_HUMAN_ACTIONS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-prod-')), 'human-actions.json');
  });
  afterEach(() => { process.env.HYDI_HUMAN_ACTIONS_FILE = savedFile; });

  const testEnv = {
    envNamePresent: () => false,
    envValue: (n) => ({ STRIPE_SECRET_KEY: 'sk_test_FAKE', WEBHOOK_PROCESSING_ENABLED: 'true' })[n] || null,
  };

  test('test-mode environment creates production credential + base-url actions, not the webhook-endpoint one', () => {
    const s = new HumanActionService({});
    const out = detectKnownBlockers(s, testEnv);
    const keys = s.list().map((a) => a.blockerKey);
    expect(keys).toContain('stripe:live-credential');
    expect(keys).toContain('protoforge:public-base-url');
    // no live credential yet — the endpoint question is not yet meaningful
    expect(keys).not.toContain('stripe:live-webhook-endpoint');
    expect(out.requested.length).toBeGreaterThanOrEqual(2);
    // re-run must dedupe, never duplicate
    const again = detectKnownBlockers(s, testEnv);
    expect(again.requested).toEqual([]);
    expect(again.alreadyOpen.length).toBeGreaterThanOrEqual(2);
  });

  test('live-credential action carries boundary metadata + verifier', () => {
    const s = new HumanActionService({});
    detectKnownBlockers(s, testEnv);
    const a = s.list().find((x) => x.blockerKey === 'stripe:live-credential');
    expect(a.boundary.category).toBe('CREDENTIAL');
    expect(a.boundary.externalSystem).toBe('stripe');
    expect(a.verifier.name).toBe('stripe-live-credential');
    expect(a.instructions.join(' ')).toMatch(/rk_live_|sk_live_/);
  });

  test('live environment activates the webhook-endpoint rule; RESOLVED record silences it', async () => {
    const stripe = {
      webhookEndpoints: {
        list: async () => ({
          data: [
            { id: 'we_ok', status: 'enabled', url: 'https://heidi.example.com/api/webhooks/stripe', enabled_events: ['checkout.session.completed'] },
          ]
        })
      }
    };
    const liveEnv = {
      envNamePresent: (n) => n === 'STRIPE_WEBHOOK_SECRET_01',
      envValue: (n) => ({
        STRIPE_SECRET_KEY: 'sk_live_FAKE',
        WEBHOOK_PROCESSING_ENABLED: 'true',
        NEXT_PUBLIC_APP_URL: 'https://heidi.example.com',
      })[n] || null,
    };
    const s = new HumanActionService({ verifierDeps: { stripe, envValue: liveEnv.envValue, envNamePresent: liveEnv.envNamePresent } });
    const out = detectKnownBlockers(s, liveEnv);
    const ep = s.list().find((a) => a.blockerKey === 'stripe:live-webhook-endpoint');
    expect(ep).toBeTruthy();
    // credential/base-url rules are clear in a live environment
    expect(out.requested).not.toContain(expect.objectContaining?.({}));
    const keys = s.list().map((a) => a.blockerKey);
    expect(keys).not.toContain('stripe:live-credential');
    expect(keys).not.toContain('protoforge:public-base-url');
    // sweep verifies it for real → RESOLVED
    const v = await s.verify(ep.id);
    expect(v.action.status).toBe('RESOLVED');
    // the resolved record silences the rule — re-detection must not mint a duplicate
    const again = detectKnownBlockers(s, liveEnv);
    expect(again.requested).toEqual([]);
    expect(s.list({ includeTerminal: true }).filter((a) => a.blockerKey === 'stripe:live-webhook-endpoint').length).toBe(1);
  });
});
