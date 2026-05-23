// core/metrics.js
//
// Prometheus metrics registry for the HYDI platform.
//
// Exposes key operational counters and histograms that the /metrics endpoint
// in hydi-processor.js serves to Prometheus. Grafana dashboards read from
// Prometheus to surface real-time pipeline health.
//
// Usage:
//   const metrics = require('./metrics');
//   metrics.consumerPolls.inc();
//   metrics.workerLatency.observe({ worker_id: 'stripe-billing-worker' }, 120);

'use strict';

const client = require('prom-client');

// Shared registry — single source of truth for all HYDI metrics
const registry = new client.Registry();

// Default Node.js runtime metrics (heap, event loop lag, GC, etc.)
client.collectDefaultMetrics({ register: registry, prefix: 'hydi_nodejs_' });

// ── Consumer pipeline counters ────────────────────────────────────────────────

const consumerPolls = new client.Counter({
  name: 'hydi_consumer_polls_total',
  help: 'Total number of Supabase polling cycles completed',
  registers: [registry]
});

const eventsProcessed = new client.Counter({
  name: 'hydi_events_processed_total',
  help: 'Total events successfully handled by a worker',
  labelNames: ['worker_id', 'event_type'],
  registers: [registry]
});

const eventsFailed = new client.Counter({
  name: 'hydi_events_failed_total',
  help: 'Total events that exhausted retries and moved to failed',
  labelNames: ['worker_id', 'event_type'],
  registers: [registry]
});

const eventsDeadLettered = new client.Counter({
  name: 'hydi_events_dead_letter_total',
  help: 'Total events routed to the dead-letter queue (no worker matched)',
  registers: [registry]
});

const eventsClaimed = new client.Counter({
  name: 'hydi_events_claimed_total',
  help: 'Total events atomically claimed from the pending queue',
  registers: [registry]
});

// ── Redis Streams broker counters ────────────────────────────────────────────

const brokerPublished = new client.Counter({
  name: 'hydi_broker_published_total',
  help: 'Total messages published to Redis Streams',
  labelNames: ['topic'],
  registers: [registry]
});

const brokerConsumed = new client.Counter({
  name: 'hydi_broker_consumed_total',
  help: 'Total messages consumed from Redis Streams and dispatched to workers',
  labelNames: ['topic', 'worker_id'],
  registers: [registry]
});

const brokerDlq = new client.Counter({
  name: 'hydi_broker_dlq_total',
  help: 'Total messages routed to hydi:dlq:deadletter by the Redis Streams consumer',
  registers: [registry]
});

// ── Queue depth gauges ────────────────────────────────────────────────────────

const supabaseQueueDepth = new client.Gauge({
  name: 'hydi_supabase_queue_depth',
  help: 'Current number of pending events in hydi_events (Supabase)',
  registers: [registry]
});

const redisStreamDepth = new client.Gauge({
  name: 'hydi_redis_stream_depth',
  help: 'Current approximate length of hydi:tasks:routing stream',
  labelNames: ['topic'],
  registers: [registry]
});

// ── Latency histograms ────────────────────────────────────────────────────────

const workerLatency = new client.Histogram({
  name: 'hydi_worker_latency_ms',
  help: 'Worker execution latency in milliseconds',
  labelNames: ['worker_id'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry]
});

const ingestLatency = new client.Histogram({
  name: 'hydi_ingest_latency_ms',
  help: 'Latency of the POST /ingest endpoint in milliseconds',
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry]
});

// ── Revenue pipeline gauges ───────────────────────────────────────────────────

const stripeEventsForwarded = new client.Counter({
  name: 'hydi_stripe_events_forwarded_total',
  help: 'Total Stripe webhook events forwarded to the HYDI ingest pipeline',
  labelNames: ['stripe_event_type'],
  registers: [registry]
});

// ── Edge Mesh: Cluster consumer group metrics ─────────────────────────────────
// Populated on each /metrics scrape via RedisStreamBroker.fetchClusterConsumerGroupMetrics()

const edgeConsumerPending = new client.Gauge({
  name: 'hydi_edge_consumer_pending',
  help: 'Pending (unacknowledged) messages per edge consumer in hydi:tasks:routing',
  labelNames: ['consumer_name'],
  registers: [registry]
});

const edgeConsumerIdleMs = new client.Gauge({
  name: 'hydi_edge_consumer_idle_ms',
  help: 'Time in ms since the edge consumer last read a message',
  labelNames: ['consumer_name'],
  registers: [registry]
});

const edgeConsumerCount = new client.Gauge({
  name: 'hydi_edge_consumer_count',
  help: 'Total number of active consumers attached to hydi:tasks:routing/hydi-workers',
  registers: [registry]
});

module.exports = {
  registry,
  // Consumer
  consumerPolls,
  eventsProcessed,
  eventsFailed,
  eventsDeadLettered,
  eventsClaimed,
  // Broker
  brokerPublished,
  brokerConsumed,
  brokerDlq,
  // Depth
  supabaseQueueDepth,
  redisStreamDepth,
  // Latency
  workerLatency,
  ingestLatency,
  // Revenue
  stripeEventsForwarded,
  // Edge Mesh
  edgeConsumerPending,
  edgeConsumerIdleMs,
  edgeConsumerCount,
  // Convenience: expose prom-client so callers don't need to re-require it
  client
};
