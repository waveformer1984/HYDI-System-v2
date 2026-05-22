/**
 * HYDI Message Broker Abstraction Layer
 *
 * This interface defines the contract for message-driven architecture,
 * allowing the core orchestrator to remain agnostic of underlying transport.
 * Supports Redis Streams, RabbitMQ, or any other pub/sub substrate.
 *
 * Invariants:
 * - All events carry immutable correlation IDs for request tracing
 * - Dead Letter Queue (DLQ) captures and preserves failed message context
 * - Consumer groups ensure at-least-once delivery semantics
 * - Stream capping prevents unbounded memory growth
 */

export interface HYDIEvent {
  /** Unique message identifier (assigned by broker) */
  id: string;

  /** Request correlation ID for distributed tracing */
  correlationId: string;

  /** Originating component (e.g., 'hydi-processor', 'protoforge', 'heidi') */
  component: string;

  /** ISO 8601 timestamp of event creation */
  timestamp: string;

  /** Event payload (component-specific schema) */
  payload: Record<string, any>;

  /** Optional: Retry count and backoff metadata */
  metadata?: {
    retryCount?: number;
    originalId?: string;
    dlqReason?: string;
  };
}

export interface PublishOptions {
  /** Optional: Force routing to Dead Letter Queue */
  forceToDeadletter?: boolean;

  /** Optional: Timeout for publish operation */
  timeoutMs?: number;

  /** Optional: Tag for stream routing logic */
  routingTag?: string;
}

export interface MessageBroker {
  /**
   * Establish connection to underlying transport.
   * Should be idempotent—calling twice is a no-op.
   */
  connect(): Promise<void>;

  /**
   * Disconnect cleanly from underlying transport.
   */
  disconnect(): Promise<void>;

  /**
   * Publish an event to a named topic.
   * The broker assigns id and timestamp; caller provides the rest.
   *
   * @param topic - Routing key/topic name
   * @param event - Event payload (without id/timestamp)
   * @param options - Optional publish behavior overrides
   * @returns Promise of the assigned message ID
   */
  publish(
    topic: string,
    event: Omit<HYDIEvent, 'id' | 'timestamp'>,
    options?: PublishOptions
  ): Promise<string>;

  /**
   * Subscribe to a topic as a named consumer within a consumer group.
   * Guarantees at-least-once delivery within the consumer group lifecycle.
   *
   * @param topic - Topic to subscribe to
   * @param consumerGroup - Consumer group identifier (shared across instances)
   * @param consumerName - Unique consumer name within the group
   * @param handler - Async function to process each event
   */
  subscribe(
    topic: string,
    consumerGroup: string,
    consumerName: string,
    handler: (event: HYDIEvent) => Promise<void>
  ): Promise<void>;

  /**
   * Acknowledge successful processing of a message.
   * Removes from consumer group's pending entry list (PEL).
   *
   * @param topic - Topic identifier
   * @param consumerGroup - Consumer group identifier
   * @param messageId - Message ID to acknowledge
   */
  ack(topic: string, consumerGroup: string, messageId: string): Promise<void>;

  /**
   * Query current consumer group state and pending message metadata.
   * Useful for debugging stalled consumers or tracking delivery guarantees.
   */
  getGroupInfo(topic: string, consumerGroup: string): Promise<GroupInfo>;

  /**
   * Retrieve metrics on stream health: message count, consumer count, etc.
   */
  getStreamMetrics(topic: string): Promise<StreamMetrics>;
}

export interface GroupInfo {
  consumerGroup: string;
  pendingCount: number;
  consumerCount: number;
  lastDeliveredId: string;
  consumers: Array<{
    name: string;
    pendingCount: number;
    idleMs: number;
  }>;
}

export interface StreamMetrics {
  topic: string;
  messageCount: number;
  consumerGroupCount: number;
  oldestMessageId: string;
  newestMessageId: string;
  approximateStreamLength: number;
}

/**
 * Error class for broker-specific failures.
 * Distinguishes transient (network) from terminal (schema) failures.
 */
export class BrokerError extends Error {
  constructor(
    public code: 'CONNECT_FAILED' | 'PUBLISH_FAILED' | 'SUBSCRIBE_FAILED' | 'ACK_FAILED' | 'UNKNOWN',
    message: string,
    public isTransient: boolean = false
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}
