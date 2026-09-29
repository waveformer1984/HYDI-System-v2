/**
 * MissionLifecycle unit tests — failure classification is deterministic,
 * stage mapping is exhaustive, governance is never misclassified as flaky.
 */

import { classifyFailure, GOAL_STATUS_TO_STAGE, MissionStage } from '../../lib/heidi/MissionLifecycle';
import type { GoalStatus } from '../../lib/heidi/GoalSystem';

describe('classifyFailure', () => {
  it('classifies timeout/connection failures as transient', () => {
    for (const reason of ['Cycle timed out after 30000ms', 'ECONNREFUSED', 'HTTP 503', 'rate limit exceeded', 'deadlock detected']) {
      expect(classifyFailure(reason)).toBe('transient');
    }
  });

  it('classifies authorization/policy failures as governance — never retried as flaky', () => {
    for (const reason of ['not authorized', 'prohibited by policy', 'permission denied', 'human_required', 'not_executable:autonomy']) {
      expect(classifyFailure(reason)).toBe('governance');
    }
  });

  it('classifies everything else as deterministic', () => {
    for (const reason of ['column foo does not exist', 'TypeError: x is not a function', 'invalid payload schema']) {
      expect(classifyFailure(reason)).toBe('deterministic');
    }
  });

  it('governance wins over transient — "authorization timed out" is governance', () => {
    expect(classifyFailure('authorization timed out')).toBe('governance');
  });
});

describe('GOAL_STATUS_TO_STAGE', () => {
  it('maps every GoalStatus to a lifecycle stage', () => {
    const statuses: GoalStatus[] = ['pending', 'active', 'in_progress', 'blocked', 'completed', 'cancelled', 'failed', 'escalated'];
    const stages = new Set<MissionStage>();
    for (const s of statuses) {
      const stage = GOAL_STATUS_TO_STAGE[s];
      expect(stage).toBeDefined();
      stages.add(stage);
    }
    // key invariants
    expect(GOAL_STATUS_TO_STAGE.completed).toBe('SUCCEEDED');
    expect(GOAL_STATUS_TO_STAGE.failed).toBe('FAILED');
    expect(GOAL_STATUS_TO_STAGE.blocked).toBe('RECOVERING');
    expect(GOAL_STATUS_TO_STAGE.escalated).toBe('ESCALATED');
    expect(GOAL_STATUS_TO_STAGE.active).toBe('EXECUTING');
  });
});
