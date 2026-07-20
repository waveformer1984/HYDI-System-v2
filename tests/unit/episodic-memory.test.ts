/**
 * Unit tests for lib/episodic-memory.ts.
 */

import { buildExperience, storeExperience, ActionOutcome } from '../../lib/episodic-memory';
import { StructuredLogger } from '../../lib/structured-logger';

jest.mock('../../lib/embeddings', () => ({
  generateEmbedding: jest.fn(async () => [0.1, 0.2, 0.3]),
}));

const { generateEmbedding } = require('../../lib/embeddings');

describe('buildExperience', () => {
  test('all actions completed -> success outcome', () => {
    const results: ActionOutcome[] = [
      { type: 'create_task', status: 'completed' },
      { type: 'send_email', status: 'completed' },
    ];
    const exp = buildExperience('do the thing', results);
    expect(exp.outcome).toBe('success');
    expect(exp.lesson).toBe('All proposed actions completed successfully.');
    expect(exp.actionsTaken).toBe(results);
    expect(exp.problem).toBe('do the thing');
  });

  test('all actions failed -> failure outcome', () => {
    const results: ActionOutcome[] = [{ type: 'send_email', status: 'failed', error: 'no api key' }];
    const exp = buildExperience('send an email', results);
    expect(exp.outcome).toBe('failure');
    expect(exp.lesson).toBe('send_email failed: no api key');
  });

  test('mixed outcomes -> partial_failure', () => {
    const results: ActionOutcome[] = [
      { type: 'create_task', status: 'completed' },
      { type: 'send_email', status: 'failed', error: 'no api key' },
    ];
    const exp = buildExperience('do two things', results);
    expect(exp.outcome).toBe('partial_failure');
    expect(exp.lesson).toBe('send_email failed: no api key');
  });

  test('failure without an error message still produces a lesson', () => {
    const results: ActionOutcome[] = [{ type: 'fetch_data', status: 'failed' }];
    const exp = buildExperience('fetch', results);
    expect(exp.lesson).toBe('fetch_data failed');
  });

  test('multiple failures are joined', () => {
    const results: ActionOutcome[] = [
      { type: 'a', status: 'failed', error: 'x' },
      { type: 'b', status: 'failed', error: 'y' },
    ];
    const exp = buildExperience('multi', results);
    expect(exp.lesson).toBe('a failed: x; b failed: y');
  });

  test('empty results list -> success (vacuously true) with the generic lesson', () => {
    const exp = buildExperience('nothing attempted', []);
    expect(exp.outcome).toBe('success');
    expect(exp.lesson).toBe('All proposed actions completed successfully.');
  });
});

describe('storeExperience', () => {
  beforeEach(() => {
    (generateEmbedding as jest.Mock).mockClear();
  });

  test('inserts a memories row with kind=episodic and structured metadata', async () => {
    const inserted: any[] = [];
    const supabase: any = {
      from: () => ({
        insert: async (row: any) => {
          inserted.push(row);
          return { error: null };
        },
      }),
    };

    const experience = buildExperience('problem X', [{ type: 'create_task', status: 'completed' }]);
    await storeExperience(supabase, 'session-1', 'user-1', experience);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].kind).toBe('episodic');
    expect(inserted[0].session_id).toBe('session-1');
    expect(inserted[0].user_id).toBe('user-1');
    expect(inserted[0].metadata).toEqual({
      problem: 'problem X',
      actions_taken: experience.actionsTaken,
      outcome: 'success',
      lesson: 'All proposed actions completed successfully.',
    });
    expect(inserted[0].content).toContain('problem X');
    expect(inserted[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test('logs and does not throw when the insert errors', async () => {
    const errorSpy = jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => {});
    const supabase: any = {
      from: () => ({ insert: async () => ({ error: { message: 'db down' } }) }),
    };
    await expect(storeExperience(supabase, 's', 'u', buildExperience('p', []))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  test('logs and does not throw when the client itself throws', async () => {
    const errorSpy = jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => {});
    const supabase: any = {
      from: () => {
        throw new Error('boom');
      },
    };
    await expect(storeExperience(supabase, 's', 'u', buildExperience('p', []))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
