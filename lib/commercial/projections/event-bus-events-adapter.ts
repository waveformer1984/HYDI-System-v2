import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventBus } from '../../event-bus';

interface EventBusEventsRow {
  id: string;
  event_type: string;
  topic: string | null;
  event_name: string | null;
  source_worker: string | null;
  correlation_id: string | null;
  occurred_at: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Bridges Postgres event_bus_events into the Event Fabric.
 *
 * Legacy Edge Functions and SQL still write directly to `event_bus_events`. This
 * adapter polls for unprojected rows, publishes them as canonical `BusEvent`s, and
 * marks them projected so they are only replayed once. It is a migration shim:
 * once all producers publish to the Event Fabric directly, this adapter can be
 * removed.
 */
export class EventBusEventsProjectionAdapter {
  private supabase: SupabaseClient;
  private bus: EventBus;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor({
    supabase,
    bus,
    intervalMs = 5000,
  }: {
    supabase: SupabaseClient;
    bus: EventBus;
    intervalMs?: number;
  }) {
    this.supabase = supabase;
    this.bus = bus;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    // Fire immediately to catch any events that arrived while the process was down,
    // then poll on the interval.
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<number> {
    const { data, error } = await this.supabase
      .from('event_bus_events')
      .select(
        'id,event_type,topic,event_name,source_worker,correlation_id,occurred_at,payload,created_at'
      )
      .is('projected_at', null)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('[EventBusEventsAdapter] Failed to query event_bus_events:', error.message);
      return 0;
    }

    const rows = (data ?? []) as EventBusEventsRow[];
    if (rows.length === 0) return 0;

    let projected = 0;
    for (const row of rows) {
      const eventType = row.topic ?? row.event_type ?? 'unknown';
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const source = row.source_worker ?? 'event-bus-events';
      const timestamp = row.occurred_at ?? row.created_at ?? new Date().toISOString();
      const correlationId = row.correlation_id ?? undefined;

      try {
        await this.bus.publish(eventType, payload, {
          source,
          timestamp,
          correlationId,
        });
      } catch (err) {
        console.error('[EventBusEventsAdapter] Publish failed for event:', row.id, err);
        continue;
      }

      const { error: updateError } = await this.supabase
        .from('event_bus_events')
        .update({ projected_at: new Date().toISOString() })
        .eq('id', row.id);

      if (updateError) {
        console.error('[EventBusEventsAdapter] Failed to mark event projected:', row.id, updateError.message);
        continue;
      }

      projected++;
    }

    return projected;
  }
}
