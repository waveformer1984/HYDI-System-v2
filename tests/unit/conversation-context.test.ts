import {
  classifyLifeIntent,
  recallAnswer,
  findProject,
  getLifeContext,
  setFocus,
  remember,
  type LifeContext,
} from '../../lib/heidi/ConversationContext';

// Minimal Supabase stub — memories rows live in an array; heidi_events
// inserts are captured. Only the methods used by ConversationContext.
function stubSupabase(rows: Record<string, unknown>[] = []) {
  const events: Record<string, unknown>[] = [];
  let seq = 0;
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  const api: any = {
    select: () => api,
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return api; },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return api; },
    order: () => api,
    limit: () => api,
    single: () => api,
    update: (u: Record<string, unknown>) => {
      const upd: any = {
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return upd; },
        then: (cb: (r: unknown) => void) => {
          for (const r of rows) if (filters.every((f) => f(r))) Object.assign(r, u);
          filters.length = 0;
          return cb({ data: null, error: null });
        },
      };
      filters.length = 0;
      return upd;
    },
    insert: (row: Record<string, unknown>) => {
      const saved = { id: `mem-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
      rows.push(saved);
      return api._table === 'heidi_events'
        ? { then: (ok: () => void) => { events.push(saved); return Promise.resolve(ok()); } }
        : {
          select: () => ({ single: async () => ({ data: saved, error: null }) }),
          then: (ok: (r: { error: null }) => void) => Promise.resolve(ok({ error: null })),
        };
    },
    then: (cb: (r: { data: unknown[]; error: null }) => void) => {
      const out = rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve(cb({ data: out, error: null }));
    },
  };
  return {
    events,
    from: (table: string) => { api._table = table; filters.length = 0; return api; },
  };
}

describe('classifyLifeIntent', () => {
  test('focus commands parse deterministically', () => {
    expect(classifyLifeIntent('focus rezonate')).toEqual({ kind: 'focus', project: 'rezonate' });
    expect(classifyLifeIntent("let's work on Proto YI")).toEqual({ kind: 'focus', project: 'Proto YI' });
    expect(classifyLifeIntent('switch to HYDI')).toEqual({ kind: 'focus', project: 'HYDI' });
  });

  test('remember parses; recall phrases classify', () => {
    expect(classifyLifeIntent('remember that I prefer terse reports')).toEqual({ kind: 'remember', text: 'I prefer terse reports' });
    expect(classifyLifeIntent('what are we working on')).toEqual({ kind: 'recall' });
    expect(classifyLifeIntent('where did we leave off')).toEqual({ kind: 'recall' });
  });

  test('investigate requires an explicit target', () => {
    expect(classifyLifeIntent('investigate 4c4b9ee2-62d7-44e8-a82b-06aa196b88e0')).toEqual({ kind: 'investigate', target: '4c4b9ee2-62d7-44e8-a82b-06aa196b88e0' });
    expect(classifyLifeIntent('investigate "MiniMax Music"')).toEqual({ kind: 'investigate', target: 'MiniMax Music' });
    expect(classifyLifeIntent('investigate stuff')).toBeNull(); // bare word, no target — falls through
    expect(classifyLifeIntent('look into it')).toBeNull();      // ambiguous — no action
  });

  test('casual chat is not an intent', () => {
    expect(classifyLifeIntent("I'm burned out today")).toBeNull();
    expect(classifyLifeIntent('how are you')).toBeNull();
    expect(classifyLifeIntent('what do you think of this melody')).toBeNull();
  });
});

describe('world model', () => {
  test('setFocus creates project + focus; recall reports it', async () => {
    const sb = stubSupabase();
    const { project, created } = await setFocus(sb as any, 'u1', 'rezonate', 's1', 'music platform');
    expect(created).toBe(true);
    const ctx = await getLifeContext(sb as any, 'u1');
    expect(ctx.focus?.project).toBe('rezonate');
    expect(findProject(ctx, 'rez')).toBeTruthy();
    const answer = recallAnswer(ctx);
    expect(answer).toContain('rezonate');
    expect(sb.events[0].event_type).toBe('context_change');
  });

  test('switching focus supersedes the old one; remember stores notes', async () => {
    const sb = stubSupabase();
    await setFocus(sb as any, 'u1', 'rezonate', 's1');
    await setFocus(sb as any, 'u1', 'hydi', 's1');
    await remember(sb as any, 'u1', 'thinking about making rezonate the revenue experiment', 's1');
    const ctx = await getLifeContext(sb as any, 'u1');
    expect(ctx.focus?.project).toBe('hydi');
    expect(ctx.notes.some((n) => n.includes('rezonate'))).toBe(true);
    expect(ctx.projects.length).toBe(2);
  });

  test('empty context recalls honestly', () => {
    const empty: LifeContext = { focus: null, projects: [], notes: [] };
    expect(recallAnswer(empty)).toContain('No focus is set');
  });
});
