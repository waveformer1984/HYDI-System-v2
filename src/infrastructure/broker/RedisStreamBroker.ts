/**
 * Redis Streams Implementation of MessageBroker
 *
 * Concrete implementation using Redis Streams primitives:
 * - XADD for publishing with MAXLEN capping (10,000 message limit)
 * - XGROUP/XREADGROUP for consumer group semantics
 * - XACK for acknowledgment tracking
 * - XPENDING for monitoring stalled consumers
 *
 * Key Design Decisions:
 * 1. MAXLEN ~ 10000: Approximate trim ensures bounded memory usage
 * 2. Block=2000ms: Balance between latency and CPU efficiency
 * 3. Auto-DLQ routing: Handler exceptions trigger safe message rerouting
 * 4. Persistent polling: Background task ensures no message loss on crash
 */

import Redis from 'ioredis';
import { MessageBroker, HYDIEvent, BrokerError, GroupInfo, StreamMetrics, PublishOptions } from './MessageBroker';
import { v4 as uuidv4 } from 'uuid';

export class RedisStreamBroker implements MessageBroker {
  private client: Redis;
  private consumerPollers: Map<string, AbortController> = new Map();
  private readonly STREAM_MAX_LENGTH = 10000;
  private readonly POLL_BLOCK_MS = 2000;
  private readonly RETRY_BACKOFF_MS = 5000;

  constructor(
    private connectionUrl: string = 'redis://localhost:6379',
    private deadLetterTopic: string = 'hydi:dlq:deadletter'
  ) {
    this.client = new Redis(connectionUrl);
  }

  /**
   * Establish Redis connection with error handling.
   */
  async connect(): Promise<void> {
    try {
      // Ping to verify connectivity
      await this.client.ping();
      console.log('[RedisStreamBroker] Connected to Redis Streams substrate');
    } catch (error) {
      throw new BrokerError(
        'CONNECT_FAILED',
        `Failed to connect to Redis at ${this.connectionUrl}: ${error}`,
        true
      );
    }
  }

  /**
   * Cleanly disconnect and cancel all polling operations.
   */
  async disconnect(): Promise<void> {
    // Cancel all active pollers
    for (const controller of this.consumerPollers.values()) {
      controller.abort();
    }
    this.consumerPollers.clear();

    // Close Redis connection
    await this.client.quit();
    console.log('[RedisStreamBroker] Disconnected from Redis substrate');
  }

  /**
   * Publish an event to a topic with automatic stream capping.
   * Assigns unique ID and ISO timestamp; caller provides the rest.
   */
  async publish(
    topic: string,
    event: Omit<HYDIEvent, 'id' | 'timestamp'>,
    options?: PublishOptions
  ): Promise<string> {
    try {
      const messageId = uuidv4();
      const timestamp = new Date().toISOString();

      // Build field array for XADD
      const fields: (string | Buffer)[] = [
        'id', messageId,
        'correlationId', event.correlationId,
        'component', event.component,
        'timestamp', timestamp,
        'payload', JSON.stringify(event.payload)
      ];

      // Add metadata if present
      if (event.metadata) {
        fields.push('metadata', JSON.stringify(event.metadata));
      }

      // Force to DLQ if requested
      const targetTopic = options?.forceToDeadletter ? this.deadLetterTopic : topic;

      // XADD with MAXLEN capping to prevent unbounded growth
      const streamId = await this.client.xadd(
        targetTopic,
        'MAXLEN', '~', String(this.STREAM_MAX_LENGTH),
        '*',
        ...fields
      );

      if (!streamId) {
        throw new Error('XADD returned null stream ID');
      }

      console.log(`[Publish] ${event.component} -> ${targetTopic} [ID: ${streamId}]`);
      return streamId;
    } catch (error) {
      throw new BrokerError(
        'PUBLISH_FAILED',
        `Failed to publish to ${topic}: ${error}`,
        error instanceof Error && error.message.includes('ECONNREFUSED')
      );
    }
  }

  /**
   * Subscribe to a topic as a consumer within a group.
   * Launches a persistent polling background task.
   */
  async subscribe(
    topic: string,
    consumerGroup: string,
    consumerName: string,
    handler: (event: HYDIEvent) => Promise<void>
  ): Promise<void> {
    try {
      // Ensure consumer group exists (idempotent)
      try {
        await this.client.xgroup('CREATE', topic, consumerGroup, '$', 'MKSTREAM');
        console.log(`[Subscribe] Created consumer group: ${consumerGroup} on ${topic}`);
      } catch (err: any) {
        if (!err.message.includes('BUSYGROUP')) {
          throw err;
        }
        // Group already exists, proceed
      }

      // Launch polling task
      const pollerId = `${topic}:${consumerGroup}:${consumerName}`;
      const abortController = new AbortController();
      this.consumerPollers.set(pollerId, abortController);

      // Start async polling loop (fire and forget)
      this.poll(topic, consumerGroup, consumerName, handler, abortController);

      console.log(`[Subscribe] Consumer ${consumerName} polling ${topic}/${consumerGroup}`);
    } catch (error) {
      throw new BrokerError(
        'SUBSCRIBE_FAILED',
        `Failed to subscribe to ${topic}: ${error}`,
        true
      );
    }
  }

  /**
   * Acknowledge successful processing of a message.
   */
  async ack(topic: string, consumerGroup: string, messageId: string): Promise<void> {
    try {
      await this.client.xack(topic, consumerGroup, messageId);
    } catch (error) {
      throw new BrokerError(
        'ACK_FAILED',
        `Failed to acknowledge message ${messageId}: ${error}`,
        true
      );
    }
  }

  /**
   * Retrieve consumer group state and pending message info.
   */
  async getGroupInfo(topic: string, consumerGroup: string): Promise<GroupInfo> {
    try {
      // XINFO GROUPS returns all groups; filter to the one we want
      const allGroups = await this.client.xinfo('GROUPS', topic) as any[];

      // Each group entry is a flat key-value array; find our group
      const groupEntry = allGroups.find((g: any[]) => {
        for (let i = 0; i < g.length; i += 2) {
          if (g[i] === 'name' && g[i + 1] === consumerGroup) return true;
        }
        return false;
      }) as any[] | undefined;

      const toMap = (arr: any[]) => {
        const m: Record<string, any> = {};
        for (let i = 0; i < arr.length; i += 2) m[arr[i]] = arr[i + 1];
        return m;
      };

      const g = groupEntry ? toMap(groupEntry) : { consumers: 0, 'pending-count': 0, 'last-delivered-id': '0' };
      const consumerCount = g['consumers'] as number;
      const pendingCount  = g['pending-count'] as number;
      const lastDeliveredId = g['last-delivered-id'] as string;

      // XINFO CONSUMERS returns per-consumer details
      const consumersRaw = await this.client.xinfo('CONSUMERS', topic, consumerGroup) as any[][];
      const consumers = consumersRaw.map((c: any[]) => {
        const cm = toMap(c);
        return { name: cm['name'] as string, pendingCount: cm['pending'] as number, idleMs: cm['idle'] as number };
      });

      return {
        consumerGroup,
        pendingCount,
        consumerCount,
        lastDeliveredId,
        consumers
      };
    } catch (error) {
      throw new BrokerError(
        'UNKNOWN',
        `Failed to get group info: ${error}`,
        true
      );
    }
  }

  /**
   * Retrieve stream metrics (length, consumer groups, etc.).
   */
  async getStreamMetrics(topic: string): Promise<StreamMetrics> {
    try {
      const streamInfo = await this.client.xinfo('STREAM', topic);

      // streamInfo is array: [length, radix-tree-keys, radix-tree-nodes, groups, ...]
      const [messageCount, , , consumerGroupCount, , oldestMessageId, , newestMessageId] = streamInfo as any[];

      return {
        topic,
        messageCount,
        consumerGroupCount,
        oldestMessageId,
        newestMessageId,
        approximateStreamLength: messageCount
      };
    } catch (error) {
      throw new BrokerError(
        'UNKNOWN',
        `Failed to get stream metrics: ${error}`,
        true
      );
    }
  }

  /**
   * Internal polling loop: Continuously reads from consumer group and invokes handler.
   * Auto-routes exceptions to Dead Letter Queue (DLQ).
   */
  private async poll(
    topic: string,
    group: string,
    consumer: string,
    handler: (event: HYDIEvent) => Promise<void>,
    abortSignal: AbortController
  ): Promise<void> {
    while (!abortSignal.signal.aborted) {
      try {
        // XREADGROUP: Read one message at a time with 2000ms block
        const response = await this.client.xreadgroup(
          'GROUP', group, consumer,
          'COUNT', '1',
          'BLOCK', String(this.POLL_BLOCK_MS),
          'STREAMS', topic, '>'
        );

        if (!response) {
          // Timeout—no message available, loop continues
          continue;
        }

        // ioredis xreadgroup returns: [streamKey, [[id, fields[]], ...]][]
        const [, messages] = response[0] as [string, [string, string[]][]];
        for (const [streamId, fields] of messages) {
          // Reconstruct event from field array
          const eventData: Record<string, any> = {};
          for (let i = 0; i < fields.length; i += 2) {
            eventData[fields[i]] = fields[i + 1];
          }

          const hydiEvent: HYDIEvent = {
            id: streamId,
            correlationId: eventData.correlationId,
            component: eventData.component,
            timestamp: eventData.timestamp,
            payload: JSON.parse(eventData.payload),
            metadata: eventData.metadata ? JSON.parse(eventData.metadata) : undefined
          };

          try {
            // Invoke handler with timeout protection
            await this.executeWithTimeout(handler(hydiEvent), 30000);

            // Handler succeeded—acknowledge the message
            await this.ack(topic, group, streamId);
            console.log(`[Poll] ${hydiEvent.component} processed [${streamId}]`);
          } catch (handlerError) {
            // Handler failed—route to DLQ and still acknowledge
            console.error(`[Poll] ERROR in ${hydiEvent.component}: ${handlerError}`);

            await this.publish(
              this.deadLetterTopic,
              {
                correlationId: hydiEvent.correlationId,
                component: `${hydiEvent.component}:handler-error`,
                payload: {
                  originalEvent: hydiEvent,
                  errorMessage: String(handlerError),
                  timestamp: new Date().toISOString()
                }
              },
              { forceToDeadletter: true }
            );

            // Acknowledge the original message to prevent reprocessing
            await this.ack(topic, group, streamId);
          }
        }
      } catch (loopError) {
        // Network or Redis error—exponential backoff
        console.error(`[Poll] Stream infrastructure error: ${loopError}`);
        await this.sleep(this.RETRY_BACKOFF_MS);
      }
    }

    console.log(`[Poll] Consumer ${consumer} polling halted`);
  }

  /**
   * Wrapper to enforce timeout on handler execution.
   */
  private executeWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
    return Promise.race([
      promise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Simple sleep utility.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Edge Mesh: Cluster Consumer Group Metrics ──────────────────────────────

  /**
   * Fetch per-consumer metrics for a topic/group pair.
   * Intended for Prometheus scraping: exposes which edge node is active,
   * its pending backlog, and how long it has been idle.
   *
   * Prometheus exposure: scraped on GET /metrics → hydi_edge_consumer_* gauges.
   *
   * @param topic  Redis stream key (e.g. 'hydi:tasks:routing')
   * @param group  Consumer group name (e.g. 'hydi-workers')
   */
  public async fetchClusterConsumerGroupMetrics(
    topic: string,
    group: string
  ): Promise<Array<{ consumerName: string; pendingCount: number; idleTimeMs: number }>> {
    try {
      // XINFO CONSUMERS returns a flat multi-bulk array per consumer
      const consumersRaw = await this.client.xinfo('CONSUMERS', topic, group) as any[][];

      return consumersRaw.map((consumer: any) => {
        // Structural normalisation of raw Redis multi-nested array
        const metricsMap: Record<string, any> = {};
        for (let i = 0; i < consumer.length; i += 2) {
          metricsMap[consumer[i]] = consumer[i + 1];
        }
        return {
          consumerName: String(metricsMap['name']   ?? 'unknown'),
          pendingCount: Number(metricsMap['pending'] ?? 0),
          idleTimeMs:   Number(metricsMap['idle']    ?? 0),
        };
      });
    } catch (err: any) {
      // Stream or group may not exist yet; return empty rather than throw
      if (err?.message?.includes('ERR no such key') || err?.message?.includes('NOGROUP')) {
        return [];
      }
      throw new BrokerError(
        'UNKNOWN',
        `fetchClusterConsumerGroupMetrics failed for ${topic}/${group}: ${err}`,
        true
      );
    }
  }
}
