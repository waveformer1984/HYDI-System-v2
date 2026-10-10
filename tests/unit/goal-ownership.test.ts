/**
 * Goal ownership invariant — regression for the managed-goal race.
 *
 * During portfolio realization a managed goal sat 'pending' for ~26s and
 * the daemon's generic planner consumed and 'completed' it — false
 * evidence of an APP_REALIZED proof. The invariant now enforced:
 *
 *   "A managed goal has exactly one execution owner."
 *
 * context.managedBy ≠ 'generic-planner' → invisible to getPendingWork,
 * regardless of status. The generic planner sees only unowned goals.
 *
 * Tier 2: needs the real local Postgres — the claim queue is SQL.
 */

import { GoalSystem } from '../../lib/heidi/GoalSystem';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

const PREFIX = `own_${Date.now()}`;

describe('managed-goal ownership (getPendingWork)', () => {
  let goals: GoalSystem;
  const created: string[] = [];

  beforeAll(() => { goals = new GoalSystem(DB_CONFIG); });
  afterAll(async () => {
    for (const id of created) {
      await goals.updateGoal(id, { status: 'cancelled' as const }).catch(() => undefined);
    }
    await goals.close().catch(() => undefined);
  });

  it('excludes managed goals from every claimable status; unowned goals stay claimable', async () => {
    const managed = await goals.createGoal({
      goalType: 'mission',
      title: `${PREFIX}_managed`,
      priority: 5,
      context: { managedBy: 'app-realization' },
    });
    const unowned = await goals.createGoal({
      goalType: 'mission',
      title: `${PREFIX}_unowned`,
      priority: 5,
      context: {},
    });
    const explicitGeneric = await goals.createGoal({
      goalType: 'mission',
      title: `${PREFIX}_generic`,
      priority: 5,
      context: { managedBy: 'generic-planner' },
    });
    created.push(managed.goalId, unowned.goalId, explicitGeneric.goalId);

    let work = await goals.getPendingWork();
    const ids = new Set(work.map((g) => g.goalId));
    expect(ids.has(unowned.goalId)).toBe(true);
    expect(ids.has(explicitGeneric.goalId)).toBe(true);
    expect(ids.has(managed.goalId)).toBe(false);

    // The status carousel can't leak it back — a managed goal is invisible
    // in pending, active, AND in_progress (the transient states a runner
    // passes through while working it).
    for (const s of ['pending', 'active', 'in_progress'] as const) {
      await goals.updateGoal(managed.goalId, { status: s });
      work = await goals.getPendingWork();
      expect(work.some((g) => g.goalId === managed.goalId)).toBe(false);
    }
  }, 30000);
});
