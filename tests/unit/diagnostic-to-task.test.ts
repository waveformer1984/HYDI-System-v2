/**
 * Diagnostic → task (E3) unit tests — Tier 1 (hermetic).
 *
 * Proves the finding→mission gate:
 *   - allowlisted taskTemplate produces a bounded investigation mission
 *   - arbitrary template strings can never name a capability
 *   - R2+ mapped capabilities are refused even if executability passes
 *   - humanRequired findings never produce missions
 *   - dedupe / cooldown / open-cap apply to finding missions
 *   - malformed findings are rejected safely
 *   - investigateDimension returns UNKNOWN for unknown dimensions
 */

import {
  MissionProducer,
  FINDING_TASK_ALLOWLIST,
  type FindingRef,
} from '../../lib/heidi/MissionProducer';
import { investigateDimension } from '../../lib/heidi/DiagnosticFollowup';
import type { Goal, GoalSystem } from '../../lib/heidi/GoalSystem';
import type { CapabilityRegistry } from '../../lib/heidi/CapabilityRegistry';

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
      return [...store].reverse().find((g) => g.context?.producerKey === key) ?? null;
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

const FINDING: FindingRef = {
  diagnosticEventId: 'diag-evt-1',
  taskTemplate: 'ops.investigate_escalation_growth',
  dimension: 'escalations',
  severity: 'DEGRADED',
  summary: '243 new open escalations in 24h',
  humanRequired: false,
};

function producerWithFindings(
  goals: ReturnType<typeof makeGoals>,
  registry: ReturnType<typeof makeRegistry>,
  findings: FindingRef[],
  maxOpen = 2,
) {
  return new MissionProducer({
    goals: goals as unknown as GoalSystem,
    registry: registry as unknown as CapabilityRegistry,
    templates: [], // isolate the findings stage from the fixed catalog
    findingSource: async () => findings,
    maxOpen,
  });
}

describe('diagnostic finding → bounded mission', () => {
  test('allowlisted finding produces an investigation mission bound to ops.investigate_finding', async () => {
    const goals = makeGoals();
    const producer = producerWithFindings(goals, makeRegistry(), [FINDING]);

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(1);
    const goal = result.created[0];
    expect(goal.context.producerKey).toBe('finding:ops.investigate_escalation_growth');
    expect(goal.context.capabilityId).toBe('ops.investigate_finding');
    expect(goal.context.capabilityParams).toMatchObject({
      dimension: 'escalations',
      taskTemplate: 'ops.investigate_escalation_growth',
      diagnosticEventId: 'diag-evt-1',
    });
    expect(goal.context.investigationOnly).toBe(true);
    expect(goal.context.noRepairAuthorized).toBe(true);
    expect(goal.description).toContain('no repair authorized');
  });

  test('arbitrary taskTemplate cannot name a capability — unknown_template, no mission', async () => {
    const goals = makeGoals();
    const producer = producerWithFindings(goals, makeRegistry(), [
      { ...FINDING, taskTemplate: 'ops.some_random_capability' },
      { ...FINDING, taskTemplate: 'tool.send_email' }, // real capability, not allowlisted
    ]);

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(0);
    expect(result.skipped.every((s) => s.reason === 'unknown_template')).toBe(true);
    expect(goals.store).toHaveLength(0);
  });

  test('R2-mapped capability is refused even when executability passes', async () => {
    const goals = makeGoals();
    const registry = makeRegistry({ riskLevels: { 'ops.investigate_finding': 'R2' } });
    const producer = producerWithFindings(goals, registry, [FINDING]);

    const result = await producer.produce([], 5);

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('risk_level:R2');
    expect(goals.store).toHaveLength(0);
  });

  test('humanRequired finding produces no mission', async () => {
    const goals = makeGoals();
    const producer = producerWithFindings(goals, makeRegistry(), [
      { ...FINDING, humanRequired: true },
    ]);

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('human_required');
  });

  test('missing/unwired capability fails safely — not_executable', async () => {
    const goals = makeGoals();
    const registry = makeRegistry({ executable: { 'ops.investigate_finding': false } });
    const producer = producerWithFindings(goals, registry, [FINDING]);

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/^not_executable/);
  });

  test('same finding while mission is open → already_open, no duplicate', async () => {
    const goals = makeGoals();
    const producer = producerWithFindings(goals, makeRegistry(), [FINDING]);

    const first = await producer.produce([], 2);
    expect(first.created).toHaveLength(1);

    // Next cycle: goal still open, same finding still in the diagnostic row.
    const second = await producer.produce(goals.store, 2);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ producerKey: 'finding:ops.investigate_escalation_growth', reason: 'already_open' }),
      ]),
    );
    expect(goals.store).toHaveLength(1);
  });

  test('completed investigation enforces cooldown — no instant re-emission', async () => {
    const completed = makeGoal({
      status: 'completed',
      context: { producerKey: 'finding:ops.investigate_escalation_growth' },
      createdAt: new Date().toISOString(),
    });
    const goals = makeGoals([completed]);
    const producer = producerWithFindings(goals, makeRegistry(), [FINDING]);

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('cooldown');
    expect(goals.store).toHaveLength(1);
  });

  test('open cap bounds finding missions the same as catalog missions', async () => {
    const open = makeGoal({ status: 'in_progress', context: { producerKey: 'other' } });
    const goals = makeGoals([open]);
    const producer = producerWithFindings(goals, makeRegistry(), [FINDING], 1);

    const result = await producer.produce(goals.store, 2);

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('open_cap:1');
  });

  test('malformed findings are rejected before they can name work', async () => {
    const goals = makeGoals();
    const producer = producerWithFindings(goals, makeRegistry(), [
      { diagnosticEventId: 'x' } as FindingRef, // no taskTemplate
      { diagnosticEventId: 'x', taskTemplate: '' },
      null as unknown as FindingRef,
    ]);

    const result = await producer.produce([], 2);

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.every((s) => s.reason === 'malformed_finding')).toBe(true);
    expect(goals.store).toHaveLength(0);
  });

  test('a failing finding source produces nothing rather than inventing work', async () => {
    const goals = makeGoals();
    const producer = new MissionProducer({
      goals: goals as unknown as GoalSystem,
      registry: makeRegistry() as unknown as CapabilityRegistry,
      templates: [],
      findingSource: async () => {
        throw new Error('db down');
      },
    });

    const result = await producer.produce([], 2);
    expect(result.created).toHaveLength(0);
  });

  test('allowlist covers exactly the four sanctioned templates', () => {
    expect(Object.keys(FINDING_TASK_ALLOWLIST).sort()).toEqual([
      'ops.investigate_cognitive_timeouts',
      'ops.investigate_escalation_growth',
      'ops.investigate_runtime_drift',
      'ops.investigate_stale_goals',
    ]);
    for (const binding of Object.values(FINDING_TASK_ALLOWLIST)) {
      expect(binding.capabilityId).toBe('ops.investigate_finding');
    }
  });
});

describe('investigateDimension executor path', () => {
  test('unknown dimension returns UNKNOWN + humanRequired, never throws', async () => {
    const finding = await investigateDimension(
      { pool: { query: async () => ({ rows: [] }) } },
      'not_a_dimension',
    );
    expect(finding.severity).toBe('UNKNOWN');
    expect(finding.humanRequired).toBe(true);
  });

  test('investigator failure returns UNKNOWN finding', async () => {
    const finding = await investigateDimension(
      {
        pool: {
          query: async () => {
            throw new Error('db down');
          },
        },
      },
      'cognitive_loop',
    );
    expect(finding.severity).toBe('UNKNOWN');
  });
});
