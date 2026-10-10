'use strict';

/**
 * Phase 7 — bounded end-to-end orchestration proof.
 *
 * Demonstrates that Heidi coordinates a representative blocked workflow
 * through the governed path, in one reproducible pass:
 *
 *   1. A real simulated blocker is detected → durable Human Action
 *   2. The action is classified: machine-solvable (R0 config-set) vs
 *      human-required (R2 live credential) vs approval-only (manual)
 *   3. The resolver sweep executes ONLY the machine-solvable work through
 *      the governed config plane — R2 is never executed
 *   4. The resolver's claim is NOT truth: verify() independently checks
 *      the world and rejects when the change didn't really land
 *   5. With the world actually changed, verify() resolves the action and
 *      the parked goal resumes through the governed sweep
 *   6. A genuine human boundary (manual verifier) resolves only by
 *      attestation — never by machine claim
 *   7. Replaying the entire workflow mints no duplicate actions and no
 *      duplicate effects
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-orch-')), 'human-actions.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { HumanActionService } = require('../../lib/human-actions/service');
const { resolveEligibleActions, verifyEligibleActions, syncHumanActions, detectKnownBlockers } = require('../../lib/human-actions/detector');
const { attachBlockerToGoal, resumeSatisfiedGoals, scanEscalatedGoals } = require('../../lib/human-actions/mission-link');
const { load } = require('../../lib/human-actions/store');

/** Fake "world": env map the verifier reads; the resolver must change it. */
const world = { env: {}, configWrites: [] };
const envFor = () => ({
  envNamePresent: (n) => world.env[n] !== undefined,
  envValue: (n) => world.env[n],
});
const fakeGoals = (seed = []) => {
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
};

const svc = () => new HumanActionService({ verifierDeps: envFor() });

describe('end-to-end orchestration proof', () => {
  const RESUME_GOAL = 'goal_orchestration_proof';

  test('detect → classify → machine-execute → verify-gate → resume → replay dedupe', async () => {
    const s = svc();

    // ── 1. Detection: blocker observed from real (simulated) state ────
    // WEBHOOK_PROCESSING_ENABLED absent → the R0 policy-registered blocker.
    const { action: webhookAction, created } = s.request({
      blockerKey: 'stripe:webhook-processing',
      type: 'deployment',
      boundary: { category: 'DEPLOYMENT', externalSystem: 'config', capability: 'revenue.production.webhook' },
      title: 'Enable Stripe webhook processing',
      description: 'WEBHOOK_PROCESSING_ENABLED is unset — signed events are dropped.',
      instructions: ['set WEBHOOK_PROCESSING_ENABLED=true'],
      verifier: { name: 'env-vars', spec: { envNames: ['WEBHOOK_PROCESSING_ENABLED'] } },
      sourceMissionId: 'orch-proof', sourceGoalId: RESUME_GOAL,
    });
    expect(created).toBe(true);
    expect(svc().listOpen().map((a) => a.id)).toContain(webhookAction.id);

    // A genuine human boundary alongside it — never machine-executable.
    const { action: credAction } = s.request({
      blockerKey: 'stripe:live-credential',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'stripe', capability: 'revenue.production' },
      title: 'Provide a live Stripe credential',
      description: 'Only sk_test_ present.',
      instructions: ['create restricted live key in Stripe dashboard'],
      verifier: { name: 'stripe-live-credential', spec: {} },
      sourceMissionId: 'orch-proof',
    });

    // And a parked goal blocked on the webhook boundary.
    const goals = fakeGoals([{ goalId: RESUME_GOAL, status: 'active', context: {} }]);
    await attachBlockerToGoal(s, goals, {
      goalId: RESUME_GOAL, blockerKey: 'stripe:webhook-processing', missionId: 'orch-proof',
      spec: {
        type: 'deployment',
        boundary: { category: 'DEPLOYMENT', externalSystem: 'config', capability: 'revenue.production.webhook' },
        title: 'Enable Stripe webhook processing',
        description: 'WEBHOOK_PROCESSING_ENABLED is unset.',
        instructions: ['set WEBHOOK_PROCESSING_ENABLED=true'],
        verifier: { name: 'env-vars', spec: { envNames: ['WEBHOOK_PROCESSING_ENABLED'] } },
      },
    });
    expect((await goals.getGoal(RESUME_GOAL)).status).toBe('escalated');

    // ── 2-3. Resolve sweep: classify all; execute ONLY the R0 one ─────
    const configPlane = {
      canAutoModify: (k) => k === 'WEBHOOK_PROCESSING_ENABLED',
      set: (key, value, actor, reason) => {
        world.configWrites.push({ key, value, actor });
        // Resolver CLAIMS completion — but only the world determines truth.
        // Deliberately do NOT update world.env yet: the verifier must catch it.
        return { success: true, verified: true };
      },
    };
    const sweep1 = await resolveEligibleActions(s, {
      env: envFor(), throttleMs: 0, actor: 'orch-proof',
      deps: { configPlane },
    });
    // Classification recorded durably on both actions.
    const cred = s.get(credAction.id);
    expect(cred.resolver.resolutionClass).toBe('R2');
    expect(s.get(webhookAction.id).resolver.resolutionClass).toBe('R0');
    // The human boundary was never executed — reported as human-path.
    expect(sweep1.human.some((h) => h.actionId === credAction.id)).toBe(true);
    expect(sweep1.attempted.some((a) => a.actionId === credAction.id)).toBe(false);
    // The machine-solvable one ran through the governed config plane.
    expect(world.configWrites).toEqual([
      expect.objectContaining({ key: 'WEBHOOK_PROCESSING_ENABLED', value: 'true' }),
    ]);

    // ── 4. Verifier owns truth: claim ≠ resolution ────────────────────
    // env still missing → verify() marked the action BLOCKED, not RESOLVED.
    const afterBadClaim = s.get(webhookAction.id);
    expect(afterBadClaim.status).toBe('BLOCKED');
    expect(afterBadClaim.resolution).not.toBe('auto_verified');
    expect(afterBadClaim.lastError).toMatch(/WEBHOOK_PROCESSING_ENABLED/);

    // The goal stays parked — an unverified claim never releases it.
    await resumeSatisfiedGoals(s, goals);
    expect((await goals.getGoal(RESUME_GOAL)).status).toBe('escalated');

    // ── 5. World actually changes → verifier resolves → goal resumes ──
    world.env.WEBHOOK_PROCESSING_ENABLED = 'true';
    const verifySweep = await verifyEligibleActions(s, { throttleMs: 0 });
    expect((verifySweep.resolved || []).map((r) => r.actionId ?? r)).toContain(webhookAction.id);
    const resolved = s.get(webhookAction.id);
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution).toBe('auto_verified');
    expect(resolved.transitions.some((t) => t.type === 'VERIFIED')).toBe(true);

    await resumeSatisfiedGoals(s, goals);
    const resumed = await goals.getGoal(RESUME_GOAL);
    // 'pending' = returned to the runnable queue; resolution of the
    // prerequisite is never reported as goal completion.
    expect(resumed.status).toBe('pending');
    expect(resumed.context.waitingOnHuman).toBe(false);
    expect(JSON.stringify(resumed.evidence)).toMatch(/HUMAN_PREREQUISITE_SATISFIED/);

    // ── 6. Genuine human boundary: attestation only, evidence-gated ───
    const { action: manualAction } = s.request({
      blockerKey: 'checkpoint:outreach-authorization',
      type: 'approval',
      boundary: { category: 'AUTHORIZATION', externalSystem: 'operator-consent', capability: 'revenue.outreach' },
      title: 'Authorize outreach',
      description: 'Consent required.',
      instructions: ['record authorization'],
      verifier: { name: 'manual', spec: {} },
      sourceMissionId: 'orch-proof',
    });
    // A verifier sweep cannot resolve a manual action — it stays open.
    await verifyEligibleActions(s, { throttleMs: 0 });
    expect(s.get(manualAction.id).status).not.toBe('RESOLVED');
    // Nor can the resolver sweep — AUTHORIZATION classifies R2/human.
    const sweep2 = await resolveEligibleActions(s, { env: envFor(), throttleMs: 0, deps: { configPlane } });
    expect(sweep2.human.some((h) => h.actionId === manualAction.id)).toBe(true);
    expect(world.configWrites).toHaveLength(1); // no second write
    // Only governed attestation closes it.
    s.resolve(manualAction.id, { actor: 'operator', note: 'email channel authorized, max 5 contacts' });
    expect(s.get(manualAction.id).status).toBe('RESOLVED');
    expect(s.get(manualAction.id).resolution).toBe('human_attested');

    // ── 7. Replay: no duplicate actions, no duplicate effects ─────────
    const before = load().actions.length;
    const replay = await resolveEligibleActions(s, { env: envFor(), throttleMs: 0, deps: { configPlane } });
    const v2 = await verifyEligibleActions(s, { throttleMs: 0 });
    // Detector replay mints nothing — the blocker condition is genuinely
    // gone (env now 'true'), so its rule is inactive. A recurring blocker
    // would mint a fresh action by design (resolved ≠ silenced).
    const reDetect = detectKnownBlockers(s, envFor());
    const webhookMints = load().actions.filter((a) => a.blockerKey === 'stripe:webhook-processing');
    expect(webhookMints).toHaveLength(1);
    // Other legitimately-active blockers (missing env in the fake world)
    // may mint new actions on the replay — that's detection working, not
    // duplication. The invariant is: no blockerKey gains a second open
    // action, and nothing resolved re-mints while the condition is gone.
    const { OPEN_STATUSES } = require('../../lib/human-actions/service');
    const openByKey = {};
    for (const a of load().actions) {
      if (!OPEN_STATUSES.has(a.status)) continue;
      openByKey[a.blockerKey] = (openByKey[a.blockerKey] || 0) + 1;
    }
    expect(Object.values(openByKey).every((n) => n === 1)).toBe(true);
    expect(world.configWrites).toHaveLength(1);   // resolver ran exactly once
    // RESOLVED actions are never re-verified or re-attempted.
    expect((v2.resolved || []).map((r) => r.actionId ?? r)).not.toContain(webhookAction.id);
    expect((replay.attempted || []).some((a) => a.actionId === webhookAction.id)).toBe(false);
    // The human boundary remains the only open machine-side truth: live
    // credential still blocked — reported, not resolved by fiat.
    expect(s.get(credAction.id).status).toBe('BLOCKED');
  });

  test('full syncHumanActions pass: detect + classify + verify + scan + resume in one call', async () => {
    const s = svc();
    const goals = fakeGoals([{ goalId: 'goal_sync', status: 'active', context: {} }]);
    const out = await syncHumanActions(s, goals, {
      env: envFor(), staleCheck: { confirmAttempts: 1 },
      resolve: { throttleMs: 0, deps: { configPlane: { canAutoModify: () => false, set: () => ({ success: false }) } } },
      verify: { throttleMs: 0 },
    });
    expect(out.detection).toBeTruthy();
    expect(out.resolve).toBeTruthy();
    expect(out.verify).toBeTruthy();
    expect(out.goalScan).toBeTruthy();
    // A second identical pass converges — no duplicated minted records.
    const n1 = load().actions.length;
    await syncHumanActions(s, goals, { env: envFor(), staleCheck: { confirmAttempts: 1 }, resolve: { throttleMs: 0 }, verify: { throttleMs: 0 } });
    expect(load().actions.length).toBe(n1);
  });
});
