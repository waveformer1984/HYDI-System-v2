/**
 * Unit tests for lib/metrics.ts — Phase 5 instrumentation.
 */

import {
  computeDecisionStats,
  computeTaskSuccessRates,
  computeWorkSessionStats,
  getDecisionStats,
  getTaskSuccessRates,
  getWorkSessionStats,
} from '../../lib/metrics';

describe('computeTaskSuccessRates', () => {
  test('groups by task_name and computes per-type success rate', () => {
    const rows = [
      { task_name: 'create_task', status: 'completed' },
      { task_name: 'create_task', status: 'completed' },
      { task_name: 'create_task', status: 'failed' },
      { task_name: 'send_email', status: 'failed' },
    ];
    const result = computeTaskSuccessRates(rows);
    const createTask = result.find((r) => r.taskType === 'create_task')!;
    const sendEmail = result.find((r) => r.taskType === 'send_email')!;

    expect(createTask).toEqual({ taskType: 'create_task', total: 3, completed: 2, failed: 1, successRate: 2 / 3 });
    expect(sendEmail).toEqual({ taskType: 'send_email', total: 1, completed: 0, failed: 1, successRate: 0 });
  });

  test('null task_name buckets under "unknown"', () => {
    const result = computeTaskSuccessRates([{ task_name: null, status: 'completed' }]);
    expect(result[0].taskType).toBe('unknown');
  });

  test('empty input returns empty array', () => {
    expect(computeTaskSuccessRates([])).toEqual([]);
  });
});

describe('computeDecisionStats', () => {
  test('counts decision types and outcome success rate', () => {
    const rows = [
      { decision: 'approve', outcome: 'success', confidence: 0.9 },
      { decision: 'approve', outcome: 'failure', confidence: 0.8 },
      { decision: 'reject', outcome: null, confidence: 0.2 },
      { decision: 'escalate', outcome: null, confidence: null },
    ];
    const stats = computeDecisionStats(rows);

    expect(stats.total).toBe(4);
    expect(stats.approved).toBe(2);
    expect(stats.rejected).toBe(1);
    expect(stats.escalated).toBe(1);
    expect(stats.outcomesRecorded).toBe(2);
    expect(stats.outcomeSuccesses).toBe(1);
    expect(stats.outcomeFailures).toBe(1);
    expect(stats.outcomeSuccessRate).toBe(0.5);
    expect(stats.averageConfidence).toBeCloseTo((0.9 + 0.8 + 0.2) / 3);
  });

  test('no outcomes recorded yet -> outcomeSuccessRate is null, not 0', () => {
    const stats = computeDecisionStats([{ decision: 'approve', outcome: null, confidence: 0.9 }]);
    expect(stats.outcomesRecorded).toBe(0);
    expect(stats.outcomeSuccessRate).toBeNull();
  });

  test('empty input returns zeroed stats with null rates, not NaN', () => {
    const stats = computeDecisionStats([]);
    expect(stats.total).toBe(0);
    expect(stats.outcomeSuccessRate).toBeNull();
    expect(stats.averageConfidence).toBeNull();
  });
});

describe('computeWorkSessionStats', () => {
  test('counts sessions by status and computes completion rate over terminal sessions only', () => {
    const rows = [
      { status: 'completed', steps: [] },
      { status: 'completed', steps: [] },
      { status: 'failed', steps: [] },
      { status: 'in_progress', steps: [] },
      { status: 'planned', steps: [] },
    ];
    const stats = computeWorkSessionStats(rows);

    expect(stats.totalSessions).toBe(5);
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.planned).toBe(1);
    // completion rate is over terminal (completed+failed) sessions: 2/3
    expect(stats.completionRate).toBeCloseTo(2 / 3);
  });

  test('planning accuracy averages completed/planned step ratio across sessions with steps', () => {
    const rows = [
      {
        status: 'completed',
        steps: [{ status: 'completed' }, { status: 'completed' }],
      },
      {
        status: 'failed',
        steps: [{ status: 'completed' }, { status: 'failed' }, { status: 'pending' }],
      },
    ];
    const stats = computeWorkSessionStats(rows);

    // session 1: 2/2 = 1.0, session 2: 1/3 = 0.333...
    expect(stats.planningAccuracy).toBeCloseTo((1 + 1 / 3) / 2);
    expect(stats.averageStepsPlanned).toBeCloseTo((2 + 3) / 2);
    expect(stats.averageStepsCompleted).toBeCloseTo((2 + 1) / 2);
  });

  test('sessions with no steps do not affect planning accuracy', () => {
    const stats = computeWorkSessionStats([{ status: 'planned', steps: [] }]);
    expect(stats.planningAccuracy).toBeNull();
    expect(stats.averageStepsPlanned).toBeNull();
  });

  test('empty input returns zeroed stats with null rates', () => {
    const stats = computeWorkSessionStats([]);
    expect(stats.totalSessions).toBe(0);
    expect(stats.completionRate).toBeNull();
    expect(stats.planningAccuracy).toBeNull();
  });

  test('no terminal sessions yet -> completionRate is null, not 0', () => {
    const stats = computeWorkSessionStats([{ status: 'in_progress', steps: [] }]);
    expect(stats.completionRate).toBeNull();
  });
});

// ── I/O wrappers — fake Supabase client, mirrors the pattern used ─────────
// throughout this repo's other lib/*.ts tests (session-state, episodic-memory)

function makeFakeSupabase(rows: unknown[] | null, error: { message: string } | null = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    is: () => chain,
    limit: async () => ({ data: rows, error }),
  };
  return { from: jest.fn(() => chain) } as any;
}

describe('getTaskSuccessRates', () => {
  test('returns computed rates on success', async () => {
    const supabase = makeFakeSupabase([{ task_name: 'create_task', status: 'completed' }]);
    const result = await getTaskSuccessRates(supabase);
    expect(result).toEqual([{ taskType: 'create_task', total: 1, completed: 1, failed: 0, successRate: 1 }]);
  });

  test('returns empty array on error, does not throw', async () => {
    const supabase = makeFakeSupabase(null, { message: 'db down' });
    await expect(getTaskSuccessRates(supabase)).resolves.toEqual([]);
  });

  test('returns empty array when the client itself throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { from: () => { throw new Error('boom'); } } as any;
    await expect(getTaskSuccessRates(supabase)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('getDecisionStats', () => {
  test('returns computed stats on success', async () => {
    const supabase = makeFakeSupabase([{ decision: 'approve', outcome: 'success', confidence: 0.9 }]);
    const stats = await getDecisionStats(supabase);
    expect(stats.approved).toBe(1);
    expect(stats.outcomeSuccessRate).toBe(1);
  });

  test('degrades to zeroed stats on error, does not throw', async () => {
    const supabase = makeFakeSupabase(null, { message: 'db down' });
    const stats = await getDecisionStats(supabase);
    expect(stats.total).toBe(0);
  });
});

describe('getWorkSessionStats', () => {
  test('returns computed stats on success', async () => {
    const supabase = makeFakeSupabase([{ status: 'completed', steps: [] }]);
    const stats = await getWorkSessionStats(supabase);
    expect(stats.completed).toBe(1);
  });

  test('degrades to zeroed stats on error, does not throw', async () => {
    const supabase = makeFakeSupabase(null, { message: 'db down' });
    const stats = await getWorkSessionStats(supabase);
    expect(stats.totalSessions).toBe(0);
  });
});
