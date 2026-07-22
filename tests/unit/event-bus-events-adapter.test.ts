import { EventBus } from '../../lib/event-bus/EventBus';
import { EventBusEventsProjectionAdapter } from '../../lib/commercial/projections/event-bus-events-adapter';

class FakeSupabaseClient {
  rows: Array<{
    id: string;
    event_type: string;
    topic: string | null;
    event_name: string | null;
    source_worker: string | null;
    correlation_id: string | null;
    occurred_at: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }> = [];
  projected = new Set<string>();

  from() {
    return this;
  }

  select() {
    return this;
  }

  is() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  eq() {
    return this;
  }

  update(values: { projected_at: string }) {
    this.lastUpdate = values;
    return this;
  }

  lastUpdate: { projected_at: string } | null = null;

  async then(
    onfulfilled: (result: { data: unknown; error: null }) => void,
    _onrejected?: (reason: unknown) => void
  ) {
    if (this.lastUpdate) {
      const targetId = this.lastUpdateId;
      if (targetId) this.projected.add(targetId);
      onfulfilled({ data: null, error: null });
      return;
    }

    const unprojected = this.rows.filter((r) => !this.projected.has(r.id));
    onfulfilled({ data: unprojected.slice(0, 100), error: null });
  }

  catch() {
    return this;
  }

  private lastUpdateId: string | null = null;

  setUpdateTarget(id: string) {
    this.lastUpdateId = id;
  }
}

describe('EventBusEventsProjectionAdapter', () => {
  let bus: EventBus;
  let fakeSupabase: FakeSupabaseClient;
  let adapter: EventBusEventsProjectionAdapter;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    fakeSupabase = new FakeSupabaseClient();
    adapter = new EventBusEventsProjectionAdapter({
      supabase: fakeSupabase as any,
      bus,
      intervalMs: 100,
    });
  });

  afterEach(() => {
    adapter.stop();
    bus.clear();
  });

  it('publishes unprojected rows to the EventBus', async () => {
    fakeSupabase.rows.push({
      id: 'evt-1',
      event_type: 'billing.updated',
      topic: null,
      event_name: null,
      source_worker: 'billing-retry-worker',
      correlation_id: 'corr-1',
      occurred_at: '2026-01-01T00:00:00Z',
      payload: { amount: 100 },
      created_at: '2026-01-01T00:00:00Z',
    });

    // The adapter's tick calls select, then for each row publishes and then updates.
    // The fake client needs to know which row is being updated.
    fakeSupabase.setUpdateTarget('evt-1');

    await adapter.tick();

    const events = bus.getHistory();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('billing.updated');
    expect(events[0].source).toBe('billing-retry-worker');
    expect(events[0].correlationId).toBe('corr-1');
    expect(events[0].payload).toEqual({ amount: 100 });
    expect(fakeSupabase.projected.has('evt-1')).toBe(true);
  });

  it('prefers topic over event_type for the event type', async () => {
    fakeSupabase.rows.push({
      id: 'evt-2',
      event_type: 'billing.updated',
      topic: 'system:escalation',
      event_name: 'escalation_warning',
      source_worker: 'health-worker',
      correlation_id: null,
      occurred_at: null,
      payload: { level: 'warning' },
      created_at: '2026-01-02T00:00:00Z',
    });
    fakeSupabase.setUpdateTarget('evt-2');

    await adapter.tick();

    const events = bus.getHistory();
    expect(events[0].type).toBe('system:escalation');
  });

  it('returns 0 when there are no unprojected rows', async () => {
    const projected = await adapter.tick();
    expect(projected).toBe(0);
  });
});
