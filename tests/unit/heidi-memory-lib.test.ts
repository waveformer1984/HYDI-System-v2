/**
 * Unit tests for lib/heidi-memory.ts.
 */

import { storeMemory, retrieveMemory } from '../../lib/heidi-memory';

jest.mock('../../lib/embeddings', () => ({
  generateEmbedding: jest.fn(async (text: string) => [text.length, 0, 0]),
}));

const { generateEmbedding } = require('../../lib/embeddings');

describe('storeMemory', () => {
  beforeEach(() => {
    (generateEmbedding as jest.Mock).mockClear();
  });

  test('inserts both user and assistant rows when neither exists yet', async () => {
    const inserted: any[] = [];
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: async () => ({ data: [], error: null }),
            }),
          }),
        }),
        insert: async (rows: any[]) => {
          inserted.push(...rows);
          return { error: null };
        },
      }),
    };

    await storeMemory(supabase, 'session-1', 'user-1', 'hello', 'hi there');

    expect(inserted).toHaveLength(2);
    expect(inserted[0].content).toBe('User: hello');
    expect(inserted[1].content).toBe('Assistant: hi there');
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  test('skips rows that already exist verbatim for this user/session', async () => {
    const inserted: any[] = [];
    let insertCalled = false;
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: async () => ({ data: [{ content: 'User: hello' }], error: null }),
            }),
          }),
        }),
        insert: async (rows: any[]) => {
          insertCalled = true;
          inserted.push(...rows);
          return { error: null };
        },
      }),
    };

    await storeMemory(supabase, 'session-1', 'user-1', 'hello', 'hi there');

    expect(insertCalled).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].content).toBe('Assistant: hi there');
    // Only the non-duplicate candidate should have its embedding generated.
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    expect(generateEmbedding).toHaveBeenCalledWith('hi there');
  });

  test('skips the insert call entirely when both rows already exist', async () => {
    let insertCalled = false;
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: async () => ({
                data: [{ content: 'User: hello' }, { content: 'Assistant: hi there' }],
                error: null,
              }),
            }),
          }),
        }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    };

    await storeMemory(supabase, 'session-1', 'user-1', 'hello', 'hi there');

    expect(insertCalled).toBe(false);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  test('falls back to storing normally when the dedup check throws', async () => {
    const inserted: any[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase: any = {
      from: () => ({
        select: () => {
          throw new Error('dedup query failed');
        },
        insert: async (rows: any[]) => {
          inserted.push(...rows);
          return { error: null };
        },
      }),
    };

    await storeMemory(supabase, 'session-1', 'user-1', 'hello', 'hi there');

    expect(inserted).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('logs and does not throw when the insert errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
        }),
        insert: async () => ({ error: { message: 'db down' } }),
      }),
    };

    await expect(storeMemory(supabase, 's', 'u', 'hello', 'hi')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('retrieveMemory', () => {
  test('returns empty string when no embedding provider is configured', async () => {
    (generateEmbedding as jest.Mock).mockResolvedValueOnce(null);
    const supabase: any = { rpc: jest.fn() };

    const result = await retrieveMemory(supabase, 'hello', 'user-1');

    expect(result).toBe('');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('joins matched memory contents into a context block', async () => {
    (generateEmbedding as jest.Mock).mockResolvedValueOnce([1, 2, 3]);
    const supabase: any = {
      rpc: jest.fn(async () => ({ data: [{ content: 'User: past msg' }, { content: 'Assistant: past reply' }] })),
    };

    const result = await retrieveMemory(supabase, 'hello', 'user-1');

    expect(result).toBe('Previous relevant context:\nUser: past msg\nAssistant: past reply');
  });
});
