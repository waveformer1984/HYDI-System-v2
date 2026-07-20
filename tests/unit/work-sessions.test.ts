/**
 * Unit tests for lib/work-sessions.ts — Phase 4 planning contract +
 * persistence helpers.
 */

import {
  buildPlanPrompt,
  createWorkSession,
  getWorkSession,
  nextPendingStep,
  PlanParser,
  updateWorkSession,
  WorkSession,
} from '../../lib/work-sessions';
import { StructuredLogger } from '../../lib/structured-logger';

describe('buildPlanPrompt', () => {
  test('includes the goal and the allowed action types', () => {
    const prompt = buildPlanPrompt('onboard a new lead', ['create_task', 'send_email']);
    expect(prompt).toContain('onboard a new lead');
    expect(prompt).toContain('create_task');
    expect(prompt).toContain('send_email');
  });
});

describe('PlanParser.parsePlan', () => {
  test('parses a valid plan', () => {
    const result = PlanParser.parsePlan(JSON.stringify({ steps: [{ type: 'create_task', payload: { title: 'x' } }] }));
    expect(result.success).toBe(true);
    expect(result.plan?.steps).toHaveLength(1);
  });

  test('parses an empty plan', () => {
    const result = PlanParser.parsePlan(JSON.stringify({ steps: [] }));
    expect(result.success).toBe(true);
    expect(result.plan?.steps).toEqual([]);
  });

  test('rejects invalid JSON', () => {
    const result = PlanParser.parsePlan('not json');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid JSON/);
  });

  test('rejects a non-array steps field', () => {
    const result = PlanParser.parsePlan(JSON.stringify({ steps: 'nope' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"steps" field must be an array/);
  });

  test('rejects a step missing type', () => {
    const result = PlanParser.parsePlan(JSON.stringify({ steps: [{ payload: {} }] }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"type" string field/);
  });

  test('rejects a step missing payload', () => {
    const result = PlanParser.parsePlan(JSON.stringify({ steps: [{ type: 'create_task' }] }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"payload" object/);
  });
});

describe('PlanParser.generateCorrectedPrompt', () => {
  test('includes the original prompt and the error', () => {
    const corrected = PlanParser.generateCorrectedPrompt('original prompt text', 'boom');
    expect(corrected).toContain('original prompt text');
    expect(corrected).toContain('boom');
  });
});

describe('PlanParser.filterAllowedSteps', () => {
  test('keeps only steps whose type is in the allowed list', () => {
    const steps = [
      { type: 'create_task', payload: {} },
      { type: 'rm_rf_slash', payload: {} },
      { type: 'send_email', payload: {} },
    ];
    const filtered = PlanParser.filterAllowedSteps(steps, ['create_task', 'send_email']);
    expect(filtered.map((s) => s.type)).toEqual(['create_task', 'send_email']);
  });

  test('never trusts an empty allowed list into keeping everything', () => {
    const steps = [{ type: 'create_task', payload: {} }];
    expect(PlanParser.filterAllowedSteps(steps, [])).toEqual([]);
  });
});

function makeFakeSupabase(overrides: Record<string, unknown> = {}) {
  return { from: jest.fn(() => overrides) } as any;
}

describe('createWorkSession', () => {
  test('inserts with status planned and steps mapped to pending', async () => {
    let insertedRow: any;
    const supabase = makeFakeSupabase({
      insert: (row: any) => {
        insertedRow = row;
        return { select: () => ({ single: async () => ({ data: { ...row, id: 'ws-1' }, error: null }) }) };
      },
    });

    const session = await createWorkSession(supabase, {
      session_id: 's1',
      user_id: 'u1',
      goal: 'do the thing',
      steps: [{ type: 'create_task', payload: { title: 'x' } }],
    });

    expect(insertedRow.status).toBe('planned');
    expect(insertedRow.steps).toEqual([{ type: 'create_task', payload: { title: 'x' }, status: 'pending' }]);
    expect(session?.id).toBe('ws-1');
  });

  test('returns null and logs when the insert errors', async () => {
    const errorSpy = jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => {});
    const supabase = makeFakeSupabase({
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'db down' } }) }) }),
    });
    const session = await createWorkSession(supabase, { session_id: 's', user_id: 'u', goal: 'g', steps: [] });
    expect(session).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('getWorkSession', () => {
  test('returns the session row', async () => {
    const supabase = makeFakeSupabase({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'ws-1' } }) }) }),
    });
    const session = await getWorkSession(supabase, 'ws-1');
    expect(session?.id).toBe('ws-1');
  });

  test('returns null when not found', async () => {
    const supabase = makeFakeSupabase({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    });
    const session = await getWorkSession(supabase, 'missing');
    expect(session).toBeNull();
  });

  test('returns null instead of throwing when the client throws', async () => {
    const errorSpy = jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => {});
    const supabase = { from: () => { throw new Error('boom'); } } as any;
    await expect(getWorkSession(supabase, 'x')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('updateWorkSession', () => {
  test('updates the given fields', async () => {
    let updatedFields: any;
    const supabase = makeFakeSupabase({
      update: (fields: any) => {
        updatedFields = fields;
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'ws-1', ...fields }, error: null }) }) }) };
      },
    });
    const session = await updateWorkSession(supabase, 'ws-1', { status: 'completed' });
    expect(updatedFields).toEqual({ status: 'completed' });
    expect(session?.status).toBe('completed');
  });

  test('returns null and logs on error', async () => {
    const errorSpy = jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => {});
    const supabase = makeFakeSupabase({
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'nope' } }) }) }) }),
    });
    const session = await updateWorkSession(supabase, 'ws-1', { status: 'failed' });
    expect(session).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('nextPendingStep', () => {
  function makeSession(steps: WorkSession['steps']): WorkSession {
    return {
      id: 'ws-1',
      session_id: 's',
      user_id: 'u',
      goal: 'g',
      status: 'in_progress',
      steps,
      created_at: '',
      updated_at: '',
    };
  }

  test('returns the first step with status pending', () => {
    const session = makeSession([
      { type: 'create_task', payload: {}, status: 'completed' },
      { type: 'send_email', payload: {}, status: 'pending' },
      { type: 'fetch_data', payload: {}, status: 'pending' },
    ]);
    expect(nextPendingStep(session)?.type).toBe('send_email');
  });

  test('returns undefined when no steps are pending', () => {
    const session = makeSession([{ type: 'create_task', payload: {}, status: 'completed' }]);
    expect(nextPendingStep(session)).toBeUndefined();
  });

  test('returns undefined for an empty plan', () => {
    expect(nextPendingStep(makeSession([]))).toBeUndefined();
  });
});
