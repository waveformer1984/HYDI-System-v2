/**
 * HumanActionQueue tests — the normalized read model must preserve
 * provenance, dedup deterministically, keep backlog distinct from
 * actionable items, and produce a truthful empty state.
 */

import { collectHumanActionQueue } from '../../lib/heidi/HumanActionQueue';

interface Fixture {
  interventions?: Record<string, unknown>[];
  authz?: Record<string, unknown>[];
  freshEsc?: Record<string, unknown>[];
  backlog?: Record<string, unknown>[];
}

function pool(f: Fixture) {
  return {
    query: async (sql: string) => {
      if (/FROM human_intervention_requests/.test(sql)) return { rows: f.interventions ?? [] };
      if (/authorization_escalation/.test(sql)) return { rows: f.authz ?? [] };
      if (/GROUP BY category/.test(sql)) return { rows: f.backlog ?? [] };
      if (/FROM operator_escalations/.test(sql)) return { rows: f.freshEsc ?? [] };
      return { rows: [] };
    },
  };
}

describe('collectHumanActionQueue', () => {
  test('empty sources → truthful empty queue', async () => {
    const q = await collectHumanActionQueue(pool({}) as any);
    expect(q.open).toBe(0);
    expect(q.backlogRowCount).toBe(0);
    expect(q.items).toEqual([]);
  });

  test('intervention normalizes with provenance; expired stays EXPIRED', async () => {
    const q = await collectHumanActionQueue(pool({
      interventions: [
        { id: 'x1', request_id: 'req-a', objective: 'grant api', blocker: 'no key', required_action: 'provision', intervention_type: 'credential', status: 'pending', created_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:00:00Z' },
        { id: 'x2', request_id: 'req-b', objective: 'old', blocker: 'aged out', required_action: 'n/a', intervention_type: 'credential', status: 'expired', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-21T10:00:00Z' },
      ],
    }) as any);
    expect(q.items).toHaveLength(2);
    const open = q.items.find((i) => i.id === 'intervention:req-a')!;
    expect(open.status).toBe('OPEN');
    expect(open.source).toBe('intervention');
    expect(open.requestedAction).toBe('provision');
    const expired = q.items.find((i) => i.id === 'intervention:req-b')!;
    expect(expired.status).toBe('EXPIRED');
    expect(q.open).toBe(1);
  });

  test('authorization escalations aggregate per capability into one decision', async () => {
    const q = await collectHumanActionQueue(pool({
      authz: [
        { cap: 'revenue.start_onboarding', reason: 'requires autonomy 3', risk: 'R2', n: '421', earliest: '2026-09-20', latest: '2026-09-21' },
      ],
    }) as any);
    expect(q.items).toHaveLength(1);
    const item = q.items[0];
    expect(item.id).toBe('authz:revenue.start_onboarding:requires autonomy 3');
    expect(item.category).toBe('capability_authorization');
    expect(item.evidence.occurrences).toBe(421);
    expect(item.status).toBe('OPEN');
    expect(item.backlog).toBe(false);
    expect(q.open).toBe(1);
  });

  test('fresh escalations itemize; old ones aggregate as backlog', async () => {
    const q = await collectHumanActionQueue(pool({
      freshEsc: [
        { id: 'e9', category: 'stuck_job', severity: 'high', title: 'job X stuck', action_required: 'inspect job', metadata: { jobId: 'j1' }, created_at: '2026-09-22T09:00:00Z' },
      ],
      backlog: [
        { category: 'stuck_job', n: '6721', oldest: '2026-08-01', newest: '2026-09-21' },
        { category: 'webhook_retry', n: '439', oldest: '2026-08-20', newest: '2026-08-28' },
      ],
    }) as any);
    const fresh = q.items.find((i) => i.id === 'escalation:e9')!;
    expect(fresh.backlog).toBe(false);
    expect(fresh.status).toBe('OPEN');
    const backlogs = q.items.filter((i) => i.backlog);
    expect(backlogs).toHaveLength(2);
    expect(q.backlogRowCount).toBe(7160);
    // backlog aggregates never inflate the open-action count
    expect(q.open).toBe(1);
    expect(backlogs.every((b) => b.priority === 9)).toBe(true);
  });

  test('ids are deterministic — same source row → same queue identity', async () => {
    const f = {
      interventions: [{ id: 'x1', request_id: 'req-a', blocker: 'b', required_action: 'a', intervention_type: 't', status: 'pending', created_at: '2026-09-22', updated_at: '2026-09-22' }],
    };
    const q1 = await collectHumanActionQueue(pool(f) as any);
    const q2 = await collectHumanActionQueue(pool(f) as any);
    expect(q1.items.map((i) => i.id)).toEqual(q2.items.map((i) => i.id));
  });

  test('ordering: interventions before auth decisions before backlog', async () => {
    const q = await collectHumanActionQueue(pool({
      interventions: [{ id: 'x1', request_id: 'req-a', blocker: 'b', required_action: 'a', intervention_type: 't', status: 'pending', created_at: '2026-09-22', updated_at: '2026-09-22' }],
      authz: [{ cap: 'x', reason: 'r', risk: 'R2', n: '5', earliest: '2026-09-21', latest: '2026-09-21' }],
      backlog: [{ category: 'test', n: '2', oldest: '2026-08-01', newest: '2026-08-02' }],
    }) as any);
    expect(q.items[0].source).toBe('intervention');
    expect(q.items[1].source).toBe('authorization_escalation');
    expect(q.items[2].backlog).toBe(true);
  });

  test('queue items carry no execution authority — status is descriptive', async () => {
    const q = await collectHumanActionQueue(pool({
      interventions: [{ id: 'x1', request_id: 'req-a', blocker: 'b', required_action: 'restart daemon', intervention_type: 't', status: 'pending', created_at: '2026-09-22', updated_at: '2026-09-22' }],
    }) as any);
    // requestedAction is text for a human to read — there is no code path
    // from a queue item to execution. Assert the shape has no executor field.
    const item = q.items[0];
    expect(Object.keys(item).sort()).toEqual([
      'authorizationLevel', 'backlog', 'category', 'createdAt', 'evidence',
      'id', 'priority', 'reason', 'requestedAction', 'source', 'status', 'updatedAt',
    ]);
  });
});
