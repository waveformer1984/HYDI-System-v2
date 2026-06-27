/**
 * REDIS STREAM CONSUMER (Ursula)
 * Subscribes to HYDI event streams via Upstash Redis.
 * Surfaces task results and failures from HYDI-System-v2 into Ursula.
 *
 * Streams consumed:
 *   hydi:task-results   — completed HYDI loop outcomes
 *   hydi:task-failures  — failed HYDI loop outcomes
 *   hydi:edge-results   — results returned from Termux edge nodes
 *
 * Streams produced:
 *   hydi:edge-tasks     — tasks dispatched to Termux edge nodes
 */

import { Redis } from '@upstash/redis';

export interface StreamMessage {
  id: string;
  data: Record<string, unknown>;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export class StreamConsumer {
  private redis: Redis | null;

  constructor() {
    this.redis = getRedis();
  }

  private get available(): boolean {
    return this.redis !== null;
  }

  /**
   * Publish a message to a stream via XADD.
   */
  async publish(stream: string, payload: Record<string, unknown>): Promise<string | null> {
    if (!this.available) return null;
    try {
      const id = await this.redis!.xadd(stream, '*', { data: JSON.stringify(payload) });
      return id as string;
    } catch (e) {
      console.warn(`[STREAM] publish error on ${stream}:`, e);
      return null;
    }
  }

  /**
   * Ensure a consumer group exists for the given stream.
   */
  async ensureGroup(stream: string, group: string): Promise<void> {
    if (!this.available) return;
    try {
      await (this.redis!.xgroup as any)('CREATE', stream, group, '$', 'MKSTREAM');
    } catch {
      // BUSYGROUP is normal — group already exists
    }
  }

  /**
   * Read new messages as a group consumer. Returns up to `count` messages.
   */
  async readGroup(
    stream: string,
    group: string,
    consumer: string,
    count = 10
  ): Promise<StreamMessage[]> {
    if (!this.available) return [];
    try {
      const results = await (this.redis!.xreadgroup as any)(
        'GROUP', group, consumer,
        'COUNT', count,
        'STREAMS', stream, '>'
      ) as Array<[string, Array<[string, Record<string, string>]>]> | null;

      if (!results) return [];
      const entries = results[0]?.[1] ?? [];
      return entries.map(([id, fields]) => {
        let data: Record<string, unknown> = {};
        if (fields.data) {
          try { data = JSON.parse(fields.data); } catch { data = {}; }
        }
        return { id, data };
      });
    } catch (e) {
      console.warn(`[STREAM] readGroup error on ${stream}:`, e);
      return [];
    }
  }

  /**
   * Acknowledge a processed message.
   */
  async ack(stream: string, group: string, messageId: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.redis!.xack(stream, group, messageId);
    } catch (e) {
      console.warn(`[STREAM] ack error:`, e);
    }
  }

  /**
   * Read the most recent N entries from a stream without a group (polling mode).
   */
  async peek(stream: string, count = 10): Promise<StreamMessage[]> {
    if (!this.available) return [];
    try {
      const results = await (this.redis!.xrevrange as any)(stream, '+', '-', { count }) as Array<[string, Record<string, string>]> | null;
      if (!results) return [];
      return results.map(([id, fields]) => {
        let data: Record<string, unknown> = {};
        if (fields.data) {
          try { data = JSON.parse(fields.data); } catch { data = {}; }
        }
        return { id, data };
      });
    } catch (e) {
      console.warn(`[STREAM] peek error on ${stream}:`, e);
      return [];
    }
  }
}

let _instance: StreamConsumer | null = null;

export function getStreamConsumer(): StreamConsumer {
  if (!_instance) _instance = new StreamConsumer();
  return _instance;
}
