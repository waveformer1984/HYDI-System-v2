/**
 * Decision evidence — the refused leg of the govern chain.
 *
 * Proposals, decisions, approvals and completed cycles already land in
 * heidi_events. These tests prove the missing leg: a chokepoint refusal
 * (AUTHORIZATION_REQUIRED / INVALID_AUTHORIZATION / PROHIBITED /
 * UNKNOWN_ACTION) produces a durable row naming the code and reason —
 * and that the evidence write can never change the refusal itself.
 */
import { recordActionRefusal } from '../../lib/heidi/DecisionEvidence';
import { ActionExecutor } from '../../lib/action-executor';
import type { ActionGateDecision } from '../../lib/governance/ActionChokepoint';

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

function makeFakeSupabase(opts: { failOn?: string } = {}) {
  const inserts: CapturedInsert[] = [];
  const client = {
    from(table: string) {
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: table === opts.failOn ? { message: 'insert rejected' } : null };
        },
        select() { return this; },
      };
    },
  };
  return { client: client as never, inserts };
}

const refusal = (code: ActionGateDecision['code']): ActionGateDecision => ({
  actionId: 'act-1',
  allowed: false,
  code,
  risk: 'R3',
  requiresAuthorization: true,
  requester: 'session:s-9',
  type: 'send_email',
  target: 'user@example.com',
  reason: `${code} test refusal`,
  timestamp: new Date().toISOString(),
});

describe('recordActionRefusal', () => {
  it('persists the refusal as an action_refused heidi_events row', async () => {
    const { client, inserts } = makeFakeSupabase();
    const result = await recordActionRefusal(client, { decision: refusal('AUTHORIZATION_REQUIRED'), sessionId: 's-9' });

    expect(result).toBeNull();
    expect(inserts).toHaveLength(1);
    const { table, row } = inserts[0];
    expect(table).toBe('heidi_events');
    expect(row.event_type).toBe('action_refused');
    expect(row.division).toBe('agents');
    expect(row.verdict).toBe('AUTHORIZATION_REQUIRED');
    const payload = row.payload as Record<string, unknown>;
    expect(payload.type).toBe('send_email');
    expect(payload.requester).toBe('session:s-9');
    expect(payload.risk).toBe('R3');
    expect(payload.code).toBe('AUTHORIZATION_REQUIRED');
    expect(payload.reason).toContain('test refusal');
    expect(payload.sessionId).toBe('s-9');
  });

  it('returns the write error instead of throwing — evidence never blocks the governed path', async () => {
    const { client } = makeFakeSupabase({ failOn: 'heidi_events' });
    const result = await recordActionRefusal(client, { decision: refusal('PROHIBITED') });
    expect(result).toBe('insert rejected');
  });

  it('reports a missing client without throwing', async () => {
    const result = await recordActionRefusal(null, { decision: refusal('UNKNOWN_ACTION') });
    expect(result).toBe('no supabase client');
  });
});

describe('ActionExecutor refusal path records evidence', () => {
  it('an ungoverned action type is refused AND the refusal lands in heidi_events', async () => {
    const { client, inserts } = makeFakeSupabase();
    const executor = new ActionExecutor(client);

    const result = await executor.execute(
      { type: 'nuke_everything', payload: {} } as never,
      'sess-evidence',
    );

    // The refusal itself is unchanged in shape and semantics.
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/^\[UNKNOWN_ACTION\]/);

    // And now there is durable evidence of it.
    const refusals = inserts.filter((i) => i.table === 'heidi_events');
    expect(refusals).toHaveLength(1);
    expect(refusals[0].row.event_type).toBe('action_refused');
    expect(refusals[0].row.verdict).toBe('UNKNOWN_ACTION');
    expect((refusals[0].row.payload as Record<string, unknown>).type).toBe('nuke_everything');
  });

  it('the refusal still holds when the evidence write fails', async () => {
    const { client, inserts } = makeFakeSupabase({ failOn: 'heidi_events' });
    const executor = new ActionExecutor(client);

    const result = await executor.execute(
      { type: 'definitely_not_a_registered_action', payload: {} } as never,
      'sess-evidence',
    );

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/^\[UNKNOWN_ACTION\]/);
    // The write was attempted — fail-soft swallows the store error.
    expect(inserts.filter((i) => i.table === 'heidi_events')).toHaveLength(1);
  });

  it('an allowed action records no refusal row', async () => {
    const { client, inserts } = makeFakeSupabase();
    const executor = new ActionExecutor(client);

    const result = await executor.execute(
      { type: 'create_task', payload: { title: 't' } } as never,
      'sess-evidence',
    );

    expect(result.error ?? '').not.toMatch(/^\[UNKNOWN_ACTION\]/);
    expect(inserts.filter((i) => i.table === 'heidi_events')).toHaveLength(0);
  });
});
