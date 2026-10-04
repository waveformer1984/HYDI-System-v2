/**
 * HumanActionQueue tests — the normalized read model must preserve
 * provenance, dedup deterministically, keep backlog distinct from
 * actionable items, and produce a truthful empty state.
 */

import { collectHumanActionQueue, acknowledgeHumanAction } from '../../lib/heidi/HumanActionQueue';

interface Fixture {
  interventions?: Record<string, unknown>[];
  authz?: Record<string, unknown>[];
  freshEsc?: Record<string, unknown>[];
  backlog?: Record<string, unknown>[];
  proposals?: Record<string, unknown>[];
  commercial?: Record<string, unknown>[]; // heidi_events division='commercial' rows
  acks?: string[]; // queueItemIds already acknowledged
}

function pool(f: Fixture, inserted: string[] = []) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO heidi_events/.test(sql)) {
        inserted.push(String(params?.[0]));
        const payload = JSON.parse(String(params?.[1]));
        return { rows: [{ id: `ack-${inserted.length}` }], payload };
      }
      if (/human_action_ack/.test(sql) && /queueItemId/.test(sql) && /= \$1/.test(sql))
        return { rows: (f.acks ?? []).includes(String(params?.[0])) ? [{ id: 'ack-1' }] : [] };
      if (/human_action_ack/.test(sql))
        return { rows: (f.acks ?? []).map((qid) => ({ qid, latest: '2026-09-22T18:00:00Z' })) };
      if (/FROM human_intervention_requests/.test(sql)) return { rows: f.interventions ?? [] };
      if (/authorization_escalation/.test(sql)) return { rows: f.authz ?? [] };
      if (/GROUP BY category/.test(sql)) return { rows: f.backlog ?? [] };
      if (/FROM operator_escalations/.test(sql)) return { rows: f.freshEsc ?? [] };
      if (/FROM heidi_action_proposals/.test(sql)) return { rows: f.proposals ?? [] };
      if (/division='commercial'/.test(sql)) return { rows: f.commercial ?? [] };
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

  test('pending action proposals surface as open queue items with governance pointer', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const q = await collectHumanActionQueue(pool({
      proposals: [{
        id: 'prop-1', capability_id: 'revenue.advance_offer',
        title: 'Advance offer offer-x', reason: 'escalation hook', status: 'pending',
        expires_at: future, created_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:00:00Z',
        offer_id: 'offer-x',
      }],
    }) as any);
    expect(q.open).toBe(1);
    const item = q.items.find((i) => i.id === 'proposal:prop-1')!;
    expect(item.source).toBe('action_proposal');
    expect(item.status).toBe('OPEN');
    expect(item.authorizationLevel).toBe('R2'); // from CapabilityRegistry
    expect(item.requestedAction).toMatch(/ACTIONS/);
    expect(item.evidence.proposalId).toBe('prop-1');
    expect(item.evidence.offerId).toBe('offer-x');
  });

  test('past-expiry pending proposal reports EXPIRED and does not count open', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const q = await collectHumanActionQueue(pool({
      proposals: [{
        id: 'prop-old', capability_id: 'world.sync', title: 'old sync',
        status: 'pending', expires_at: past,
        created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z', offer_id: null,
      }],
    }) as any);
    expect(q.open).toBe(0);
    expect(q.items.find((i) => i.id === 'proposal:prop-old')!.status).toBe('EXPIRED');
  });

  test('boundary commercial offers surface as open payment-boundary items', async () => {
    const q = await collectHumanActionQueue(pool({
      commercial: [
        {
          event_type: 'commercial_offer', created_at: '2026-09-22T10:00:00Z', payload: {
            offerId: 'offer-a1', opportunityId: 'opp-1', product: 'protoforge_model_prep',
            priceCents: 2900, currency: 'usd', stage: 'AUTHORIZATION_REQUIRED',
            stageReason: 'no customer identity'
          }
        },
        {
          event_type: 'commercial_offer', created_at: '2026-09-22T11:00:00Z', payload: {
            offerId: 'offer-b2', opportunityId: 'opp-2', product: 'protoforge_model_prep',
            priceCents: 2900, currency: 'usd', stage: 'CHECKOUT_READY'
          }
        },
      ],
    }) as any);
    const item = q.items.find((i) => i.id === 'offer:offer-a1')!;
    expect(item.source).toBe('commercial_offer');
    expect(item.status).toBe('OPEN');
    expect(item.category).toBe('payment_boundary');
    expect(item.reason).toContain('AUTHORIZATION_REQUIRED');
    expect(item.reason).toContain('no customer identity');
    expect(item.requestedAction).toMatch(/governed revenue\.advance_offer/);
    // CHECKOUT_READY is also a human boundary: no customer identity has
    // been supplied — the system cannot invent one. Surfaces as
    // customer_required (priority above generic payment boundaries).
    const ready = q.items.find((i) => i.id === 'offer:offer-b2')!;
    expect(ready.status).toBe('OPEN');
    expect(ready.category).toBe('customer_required');
    expect(ready.priority).toBe(1);
    expect(ready.reason).toContain('CHECKOUT_READY');
    expect(ready.reason).toMatch(/no legitimate customer identity/i);
    expect(ready.requestedAction).toMatch(/governed revenue\.advance_offer/);
    expect(q.open).toBe(2);
  });
});

describe('acknowledgeHumanAction — governed write', () => {
  const intervention = {
    id: 'x1', request_id: 'req-a', blocker: 'missing key', required_action: 'provision',
    intervention_type: 'credential', status: 'pending',
    created_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:00:00Z',
  };

  test('acknowledges an OPEN item and the overlay flips it to ACKNOWLEDGED', async () => {
    const inserted: string[] = [];
    // after insert, the fixture reports the item as acked
    const f: Fixture = { interventions: [intervention], acks: [] };
    const p = pool(f, inserted);
    const res = await acknowledgeHumanAction(p as any, 'intervention:req-a', 'operator');
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe('acknowledged');
    expect(res.acknowledgementId).toBeDefined();
    expect(inserted).toHaveLength(1);
    // overlay: same queue now shows ACKNOWLEDGED
    f.acks = ['intervention:req-a'];
    const q = await collectHumanActionQueue(p as any);
    expect(q.items.find((i) => i.id === 'intervention:req-a')!.status).toBe('ACKNOWLEDGED');
    expect(q.open).toBe(0); // no longer counts as open work
  });

  test('repeat acknowledgement is idempotent — no second write', async () => {
    const inserted: string[] = [];
    const p = pool({ interventions: [intervention], acks: ['intervention:req-a'] }, inserted);
    const res = await acknowledgeHumanAction(p as any, 'intervention:req-a', 'operator');
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe('already_acknowledged');
    expect(inserted).toHaveLength(0);
  });

  test('nonexistent item fails closed', async () => {
    const p = pool({});
    const res = await acknowledgeHumanAction(p as any, 'intervention:nope', 'operator');
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('not_found');
  });

  test('expired item refuses with defined outcome', async () => {
    const p = pool({
      interventions: [{ ...intervention, status: 'expired', request_id: 'req-old' }],
    });
    const res = await acknowledgeHumanAction(p as any, 'intervention:req-old', 'operator');
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('expired');
  });

  test('missing/empty id fails closed before any query', async () => {
    const p = pool({});
    const res = await acknowledgeHumanAction(p as any, '', 'operator');
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('not_found');
  });
});
