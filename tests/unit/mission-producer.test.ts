/**
 * MissionProducer unit tests — Tier 1 (hermetic, no sockets).
 *
 * Proves the governed goal-production bounds:
 *   - produces exactly one mission per producerKey, bound to a capability
 *   - second invocation does not duplicate (idempotent)
 *   - non-executable capabilities are skipped, never forced
 *   - R2+ risk is never produced even if the executor gate would pass
 *   - cooldown prevents instant re-emission after completion
 *   - open-goal cap bounds total produced work
 */

import { MissionProducer, MissionTemplate, PRODUCER_ID } from '../../lib/heidi/MissionProducer';
import type { Goal, GoalSystem } from '../../lib/heidi/GoalSystem';
import type { CapabilityRegistry } from '../../lib/heidi/CapabilityRegistry';

const TEMPLATE_A: MissionTemplate = {
  producerKey: 'test.sync',
  title: 'Test sync mission',
  description: 'sync it',
  purpose: 'testing',
  capabilityId: 'world.sync',
  priority: 8,
  minIntervalMs: 60_000,
  reason: 'because the audit said so',
};

const TEMPLATE_B: MissionTemplate = {
  producerKey: 'test.health',
  title: 'Test health mission',
  description: 'check it',
  purpose: 'testing',
  capabilityId: 'self_sufficiency.check_all_capabilities',
  priority: 5,
  minIntervalMs: 60_000,
  reason: 'health drifts',
};

let nextId = 0;
function makeGoal(over: Partial<Goal>): Goal {
  return {
    goalId: `goal-${++nextId}`,
    parentId: null,
    goalType: 'mission',
    title: 'g',
    description: null,
    purpose: null,
    priority: 5,
    status: 'pending',
    constraints: [],
    dependencies: [],
    successCriteria: [],
    owner: 'heidi',
    deadline: null,
    progress: 0,
    confidence: 0.5,
    evidence: [],
    assignedAgent: null,
    context: {},
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

function makeGoals(seed: Goal[] = []) {
  const store = [...seed];
  return {
    store,
    async createGoal(input: any): Promise<Goal> {
      const goal = makeGoal({
        title: input.title,
        description: input.description ?? null,
        purpose: input.purpose ?? null,
        priority: input.priority ?? 5,
        context: input.context ?? {},
      });
      store.push(goal);
      return goal;
    },
    async getLatestByProducerKey(key: string): Promise<Goal | null> {
      const found = [...store].reverse().find((g) => g.context?.producerKey === key);
      return found ?? null;
    },
  };
}

function makeRegistry(opts: {
  executable?: Record<string, boolean>;
  riskLevels?: Record<string, string>;
} = {}) {
  return {
    isExecutable: jest.fn((id: string, _level: number) =>
      opts.executable?.[id] === false
        ? { executable: false, reason: 'not wired' }
        : { executable: true, reason: 'ok' }),
    get: jest.fn((id: string) => {
      const riskLevel = opts.riskLevels?.[id] ?? 'R0';
      return riskLevel === 'absent' ? null : { capabilityId: id, riskLevel };
    }),
  };
}

describe('MissionProducer', () => {
  test('produces a mission bound to an executable capability with reason recorded', async () => {
    const goals = makeGoals();
    const registry = makeRegistry();
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A],
    });

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(1);
    const goal = result.created[0];
    expect(goal.goalType).toBe('mission');
    expect(goal.context.producerKey).toBe('test.sync');
    expect(goal.context.capabilityId).toBe('world.sync');
    expect(goal.context.producedBy).toBe(PRODUCER_ID);
    expect(goal.context.reason).toBe('because the audit said so');
    expect(goal.context.completeOnVerify).toBe(true);
  });

  test('second invocation does not create a duplicate while the goal is open', async () => {
    const goals = makeGoals();
    const registry = makeRegistry();
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A],
    });

    const first = await producer.produce([], 2);
    expect(first.created).toHaveLength(1);

    // Simulate the loop's next cycle: the open goal list now includes it.
    const second = await producer.produce(goals.store, 2);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ producerKey: 'test.sync' })]),
    );
    expect(goals.store).toHaveLength(1);
  });

  test('skips capabilities the registry reports as not executable', async () => {
    const goals = makeGoals();
    const registry = makeRegistry({ executable: { 'world.sync': false } });
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A],
    });

    const result = await producer.produce([], 2);
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/^not_executable/);
    expect(goals.store).toHaveLength(0);
  });

  test('never produces work above the autonomous risk ceiling', async () => {
    const goals = makeGoals();
    // isExecutable passes (hypothetical higher autonomy) but riskLevel is R2
    // — the defense-in-depth check must still refuse.
    const registry = makeRegistry({ riskLevels: { 'world.sync': 'R2' } });
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A],
    });

    const result = await producer.produce([], 5);
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('risk_level:R2');
    expect(goals.store).toHaveLength(0);
  });

  test('cooldown prevents re-emission right after the goal completes', async () => {
    const completed = makeGoal({
      status: 'completed',
      context: { producerKey: 'test.sync' },
      createdAt: new Date().toISOString(),
    });
    const goals = makeGoals([completed]);
    const registry = makeRegistry();
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A],
    });

    // The goal is completed (not open) — without the cooldown this would
    // recreate it every cycle forever.
    const result = await producer.produce([], 2);
    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('cooldown');
    expect(goals.store).toHaveLength(1);
  });

  test('re-emits after the cooldown window has passed', async () => {
    const old = makeGoal({
      status: 'completed',
      context: { producerKey: 'test.sync' },
      createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    });
    const goals = makeGoals([old]);
    const registry = makeRegistry();
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A],
    });

    const result = await producer.produce([], 2);
    expect(result.created).toHaveLength(1);
    expect(goals.store).toHaveLength(2);
  });

  test('open-goal cap bounds total produced work', async () => {
    const open = makeGoal({
      status: 'in_progress',
      context: { producerKey: 'test.other' },
    });
    const goals = makeGoals([open]);
    const registry = makeRegistry();
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: registry as unknown as CapabilityRegistry,
      templates: [TEMPLATE_A, TEMPLATE_B],
      maxOpen: 1,
    });

    const result = await producer.produce(goals.store, 2);
    expect(result.created).toHaveLength(0);
    expect(result.skipped.every((s) => s.reason === 'open_cap:1')).toBe(true);
  });
});
