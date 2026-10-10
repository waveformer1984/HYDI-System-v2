/**
 * Autonomous-loop end-to-end test — Tier 2 (requires local Supabase
 * Postgres on 54322). Registered in tests/TEST_TIERS.json.
 *
 * Proves the Phase B build: a governed producer emits a real mission,
 * the cognitive loop selects it, authorization passes (R0), the bound
 * capability executes, the contract verifies it, the goal completes,
 * and the whole chain is persisted to heidi_events.
 *
 * Also proves the negative gates: an R2-bound goal is refused
 * (human_required), and a failing executor leaves observable evidence.
 *
 * Cleanup contract: every goal created here (directly or by the
 * producer) is deleted in afterEach. The producer's own dedupe key
 * namespace is `test-autoloop.*` so it cannot collide with the live
 * `ops.*` catalog.
 */

import { Client } from 'pg';
import { CognitiveCore } from '../../lib/heidi/CognitiveCore';
import { GoalSystem } from '../../lib/heidi/GoalSystem';
import { MissionProducer, MissionTemplate } from '../../lib/heidi/MissionProducer';
import { getCapabilityRegistry } from '../../lib/heidi/CapabilityRegistry';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

const TEST_TEMPLATE: MissionTemplate = {
  producerKey: 'test-autoloop.world_sync',
  title: 'Autonomous-loop qualification: world sync',
  description: 'Produced by the test harness to prove mission→capability→verify→complete.',
  purpose: 'Qualification',
  capabilityId: 'world.sync',
  priority: 10, // outrank catalog (5-6) and stray pending work
  minIntervalMs: 0,
  reason: 'Phase B build verification',
};

const db = new Client(DB_CONFIG);

async function cleanupTestGoals() {
  await db.query(`DELETE FROM heidi_goals WHERE context->>'producedBy' = 'heidi-mission-producer'`);
  await db.query(`DELETE FROM heidi_goals WHERE title LIKE 'Autonomous-loop test:%'`);
}

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(cleanupTestGoals);
afterEach(cleanupTestGoals);

describe('Autonomous governed loop (Phase B)', () => {
  test('produces a real mission and the loop executes it to completion', async () => {
    const goals = new GoalSystem(DB_CONFIG);
    const registry = getCapabilityRegistry();
    const producer = new MissionProducer({
      goals,
      registry,
      templates: [TEST_TEMPLATE],
    });
    const core = new CognitiveCore(DB_CONFIG, undefined, { missionProducer: producer });

    const state = await core.runCycle();

    // 1. Producer emitted exactly one mission, bound to world.sync.
    expect(state.producedMissions).not.toBeNull();
    expect(state.producedMissions!.created).toHaveLength(1);
    const producedGoal = state.producedMissions!.created[0];
    expect(producedGoal.context.capabilityId).toBe('world.sync');

    // 2. The planner selected the produced mission's capability.
    expect(state.selectedAction?.capabilityId).toBe('world.sync');
    expect(state.selectedAction?.targetGoalId).toBe(producedGoal.goalId);

    // 3. Authorization: R0 → authorized autonomously.
    expect(state.authorizationResult?.authorized).toBe(true);
    expect(state.authorizationResult?.authorizationMode).toBe('autonomous');

    // 4. Execution reached the real capability executor.
    expect(state.executionResult?.executed).toBe(true);
    expect(state.executionResult?.capabilityId).toBe('world.sync');
    expect(state.executionResult?.outcome).toBe('success');

    // 5. Independent contract verification ran (count:heidi_world_model > 0).
    expect(state.verificationResult?.verified).toBe(true);
    expect(state.verificationResult?.verificationStrategy).toContain('world.sync');

    // 6. The goal is durably completed — not just marked in_progress.
    const goal = await goals.getGoal(producedGoal.goalId);
    expect(goal?.status).toBe('completed');
    expect(goal?.progress).toBe(1.0);
    expect(goal?.evidence.length).toBeGreaterThan(0);

    // 7. The cycle record persisted the full chain in heidi_events.
    const evt = await db.query(
      `SELECT payload FROM heidi_events
       WHERE event_type = 'cognitive_cycle' AND payload->>'cycleId' = $1`,
      [state.cycleId],
    );
    expect(evt.rows).toHaveLength(1);
    const payload = evt.rows[0].payload;
    expect(payload.producedMissions.created).toContain(producedGoal.goalId);
    expect(payload.authorized).toBe(true);
    expect(payload.executed).toBe(true);
    expect(payload.verified).toBe(true);
    expect(payload.outcome).toBe('success');

    await goals.close();
    await core.close();
  }, 60000);

  test('producer is idempotent across consecutive cycles', async () => {
    const goals = new GoalSystem(DB_CONFIG);
    const producer = new MissionProducer({
      goals,
      registry: getCapabilityRegistry(),
      templates: [TEST_TEMPLATE],
    });
    const core = new CognitiveCore(DB_CONFIG, undefined, { missionProducer: producer });

    await core.runCycle();
    const second = await core.runCycle();

    // The mission completed in cycle 1; minIntervalMs=0 allows re-emission,
    // but during the SAME open window nothing duplicates. Cycle 2 may
    // legitimately create a fresh mission (the previous one completed) —
    // the invariant is: never two OPEN goals with the same producerKey.
    const open = await db.query(
      `SELECT COUNT(*)::int AS n FROM heidi_goals
       WHERE context->>'producerKey' = $1
         AND status IN ('pending','active','in_progress','blocked')`,
      [TEST_TEMPLATE.producerKey],
    );
    expect(open.rows[0].n).toBeLessThanOrEqual(1);
    expect(second.producedMissions).not.toBeNull();

    await goals.close();
    await core.close();
  }, 120000);

  test('a goal bound to an R2 capability is refused by authorization, not executed', async () => {
    const goals = new GoalSystem(DB_CONFIG);
    const registry = getCapabilityRegistry();
    const r2Cap = registry.listAll().find((c) => c.riskLevel === 'R2');
    expect(r2Cap).toBeDefined();

    // Wire a spy executor so the capability is selectable (status available
    // + executor present). Authorization must still refuse it: the
    // capability requires autonomy level 3 and the identity runs at 2.
    const spy = jest.fn(async () => ({
      capabilityId: r2Cap!.capabilityId,
      executed: true,
      outcome: 'success' as const,
      result: null,
      error: null,
      evidence: [],
      verified: true,
      verificationDetails: 'spy',
    }));
    registry.register(r2Cap!, spy);

    try {
      const goal = await goals.createGoal({
        goalType: 'mission',
        title: 'Autonomous-loop test: R2 refused',
        priority: 10,
        context: { capabilityId: r2Cap!.capabilityId, capabilityParams: {} },
      });

      const core = new CognitiveCore(DB_CONFIG, undefined, { missionProducer: null });
      const state = await core.runCycle();

      expect(state.selectedAction?.capabilityId).toBe(r2Cap!.capabilityId);
      expect(state.authorizationResult?.authorized).toBe(false);
      expect(state.authorizationResult?.authorizationMode).toBe('human_required');
      expect(state.executionResult?.executed).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      const after = await goals.getGoal(goal.goalId);
      expect(after?.status).not.toBe('completed');

      await goals.close();
      await core.close();
    } finally {
      // Restore the registry singleton: unwired, unavailable.
      registry.register(r2Cap!);
    }
  }, 60000);

  test('a failing executor produces observable evidence, not a silent pass', async () => {
    const goals = new GoalSystem(DB_CONFIG);
    // goal.complete with an empty goalId param fails deterministically.
    const goal = await goals.createGoal({
      goalType: 'mission',
      title: 'Autonomous-loop test: executor failure',
      priority: 10,
      context: { capabilityId: 'goal.complete', capabilityParams: { goalId: '' } },
    });

    const core = new CognitiveCore(DB_CONFIG, undefined, { missionProducer: null });
    const state = await core.runCycle();

    expect(state.executionResult?.outcome).toBe('failure');
    expect(state.executionResult?.executed).toBe(false);

    // Deviation evidence is recorded on the goal by replanOnDeviation.
    const after = await goals.getGoal(goal.goalId);
    expect(after?.evidence.length).toBeGreaterThan(0);

    await goals.close();
    await core.close();
  }, 60000);
});
