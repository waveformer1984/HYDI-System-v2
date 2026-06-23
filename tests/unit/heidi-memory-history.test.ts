/**
 * Unit tests for the short-term conversation memory helpers in
 * lib/heidi-memory.ts: getHistoryLimit, getRecentHistory, formatHistory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getHistoryLimit,
  getRecentHistory,
  formatHistory,
  ConversationTurn,
} from '../../lib/heidi-memory';

/**
 * Build a Supabase stub whose memories query resolves to `rows` (newest-first,
 * as the real `.order('created_at', { ascending: false })` would return).
 * Captures the final `.limit()` arg and the `.eq()` filter for assertions.
 */
function makeSupabase(rows: Array<{ content: string }> | null) {
  const calls: { eq?: [string, unknown]; limit?: number } = {};
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.eq = [col, val];
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      calls.limit = n;
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const supabase = { from: () => builder } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe('getHistoryLimit', () => {
  const saved = process.env.HEIDI_HISTORY_TURNS;
  afterEach(() => {
    if (saved === undefined) delete process.env.HEIDI_HISTORY_TURNS;
    else process.env.HEIDI_HISTORY_TURNS = saved;
  });

  it('defaults to 6 when unset', () => {
    delete process.env.HEIDI_HISTORY_TURNS;
    expect(getHistoryLimit()).toBe(6);
  });

  it('honours a valid positive override', () => {
    process.env.HEIDI_HISTORY_TURNS = '10';
    expect(getHistoryLimit()).toBe(10);
  });

  it('ignores invalid / non-positive values', () => {
    process.env.HEIDI_HISTORY_TURNS = '0';
    expect(getHistoryLimit()).toBe(6);
    process.env.HEIDI_HISTORY_TURNS = 'abc';
    expect(getHistoryLimit()).toBe(6);
  });
});

describe('getRecentHistory', () => {
  it('returns [] when there are no rows', async () => {
    const { supabase } = makeSupabase([]);
    expect(await getRecentHistory(supabase, 'sess-1')).toEqual([]);
  });

  it('returns [] (degrades) when the query throws', async () => {
    const supabase = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as SupabaseClient;
    expect(await getRecentHistory(supabase, 'sess-1')).toEqual([]);
  });

  it('reverses to chronological order and recovers roles from prefixes', async () => {
    // newest-first from the DB
    const { supabase } = makeSupabase([
      { content: 'Assistant: your name is Alex' },
      { content: 'User: what is my name?' },
      { content: 'Assistant: noted, Alex' },
      { content: 'User: my name is Alex' },
    ]);
    const history = await getRecentHistory(supabase, 'sess-1');
    expect(history).toEqual<ConversationTurn[]>([
      { role: 'user', content: 'my name is Alex' },
      { role: 'assistant', content: 'noted, Alex' },
      { role: 'user', content: 'what is my name?' },
      { role: 'assistant', content: 'your name is Alex' },
    ]);
  });

  it('treats an unprefixed row as a user message', async () => {
    const { supabase } = makeSupabase([{ content: 'legacy row without prefix' }]);
    const history = await getRecentHistory(supabase, 'sess-1');
    expect(history).toEqual([{ role: 'user', content: 'legacy row without prefix' }]);
  });

  it('scopes the query by session_id and applies the limit', async () => {
    const { supabase, calls } = makeSupabase([]);
    await getRecentHistory(supabase, 'sess-42', 4);
    expect(calls.eq).toEqual(['session_id', 'sess-42']);
    expect(calls.limit).toBe(4);
  });
});

describe('formatHistory', () => {
  it('returns empty string for no history', () => {
    expect(formatHistory([])).toBe('');
  });

  it('renders a labelled transcript with Heidi for assistant turns', () => {
    const out = formatHistory([
      { role: 'user', content: 'my name is Alex' },
      { role: 'assistant', content: 'noted, Alex' },
    ]);
    expect(out).toBe('Recent conversation:\nUser: my name is Alex\nHeidi: noted, Alex');
  });
});
