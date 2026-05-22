// core/redis-stream-consumer.js
//
// Redis Streams → Worker Bridge (Phase 3 Milestone 3)
//
// Subscribes to `hydi:tasks:routing` via the RedisStreamBroker and dispatches
// each arriving HYDIEvent directly through the existing worker/dispatcher
// pipeline — the same path used by the Supabase consumer-loop.
//
// This closes the loop: events can enter HYDI through two channels:
//   1. POST /ingest → Supabase → consumer-loop → worker    (legacy/HTTP path)
//   2. Redis Streams publish → this consumer → worker      (broker path)
//
// Both channels reach the same workers, the same circuit-breaker, and the
// same Prometheus metrics. The Streams path gives sub-second delivery even
// when Supabase is under load.
//
// Usage (inside hydi-processor.js after registering workers):
//   const { RedisStreamConsumer } = require('./core/redis-stream-consumer');
//   const streamConsumer = new RedisStreamConsumer({ router, registry, breaker });
//   await streamConsumer.start();

'use strict';

const Redis  = require('ioredis');
const { dispatch } = require('./dispatcher');

// Optional Prometheus metrics — graceful if not present
let metrics;
try { metrics = require('./metrics'); } catch (_) { metrics = null; }

const REDIS_URL       = process.env.REDIS_URL || 'redis://localhost:6379';
const ROUTING_TOPIC   = 'hydi:tasks:routing';
const DLQ_TOPIC       = 'hydi:dlq:deadletter';
const CONSUMER_GROUP  = 'hydi-workers';
const CONSUMER_NAME   = `hydi-processor-${process.pid}`;
const BLOCK_MS        = 2000;
const BATCH_SIZE      = 5;
const RETRY_BACKOFF   = 5000;

class RedisStreamConsumer {
  constructor({ router, registry, breaker, logger = console } = {}) {
    if (!router || !registry || !breaker) {
      throw new Error('RedisStreamConsumer requires router, registry, breaker');
    }
    this.router  = router;
    this.registry = registry;
    this.breaker  = breaker;
    this.log      = logger;
    this.running  = false;
    this._stop    = false;
    this.client   = new Redis(REDIS_URL);
    this.dlq      = new Redis(REDIS_URL);
    this.metrics  = { polled: 0, dispatched: 0, failed: 0, dlq: 0 };
  }

  async start() {
    if (this.running) return;
    this._stop   = false;
    this.running = true;

    // Create consumer group idempotently (start from newest message: $)
    try {
      await this.client.xgroup('CREATE', ROUTING_TOPIC, CONSUMER_GROUP, '$', 'MKSTREAM');
      this.log.log(`[stream-consumer] Created consumer group ${CONSUMER_GROUP} on ${ROUTING_TOPIC}`);
    } catch (e) {
      if (!e.message.includes('BUSYGROUP')) throw e;
    }

    this.log.log(`[stream-consumer] Starting — topic=${ROUTING_TOPIC} group=${CONSUMER_GROUP} consumer=${CONSUMER_NAME}`);
    this._poll().catch((e) => {
      this.log.error('[stream-consumer] Poll loop crashed:', e.message);
      this.running = false;
    });
  }

  async stop() {
    this._stop = true;
    const deadline = Date.now() + 10_000;
    while (this.running && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    try { await this.client.quit(); } catch (_) {}
    try { await this.dlq.quit(); } catch (_) {}
    this.log.log('[stream-consumer] Stopped');
  }

  async _poll() {
    while (!this._stop) {
      this.metrics.polled++;
      try {
        const response = await this.client.xreadgroup(
          'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
          'COUNT', String(BATCH_SIZE),
          'BLOCK', String(BLOCK_MS),
          'STREAMS', ROUTING_TOPIC, '>'
        );

        if (!response) continue; // timeout — no messages

        const [, messages] = response[0];
        for (const [streamId, fields] of messages) {
          await this._dispatch(streamId, fields);
        }
      } catch (e) {
        this.log.error('[stream-consumer] Poll error:', e.message);
        await new Promise(r => setTimeout(r, RETRY_BACKOFF));
      }
    }
    this.running = false;
    this.log.log('[stream-consumer] Poll loop exited');
  }

  async _dispatch(streamId, fields) {
    // Decode flat key-value field array → object
    const raw = {};
    for (let i = 0; i < fields.length; i += 2) raw[fields[i]] = fields[i + 1];

    let payload;
    try { payload = JSON.parse(raw.payload || '{}'); } catch (_) { payload = {}; }

    // Construct a hydi_events-compatible event object for the router
    const event = {
      event_id:  raw.id || streamId,
      type:      payload.type || raw.component || 'unknown',
      event_type: payload.type || raw.component || 'unknown',
      source:    raw.component || 'redis-stream',
      payload,
      timestamp: raw.timestamp || new Date().toISOString(),
      // Carry correlation ID forward for distributed tracing
      correlationId: raw.correlationId
    };

    this.log.log(`[stream-consumer] Dispatching stream msg ${streamId} type=${event.type}`);

    let decision;
    try {
      decision = await this.router.route(event);
    } catch (e) {
      this.log.error(`[stream-consumer] Route error for ${streamId}:`, e.message);
      await this._toDlq(streamId, raw, `route error: ${e.message}`);
      await this._ack(streamId);
      return;
    }

    if (decision.action === 'dead_letter' || !decision.worker) {
      this.log.log(`[stream-consumer] ${streamId} → DLQ (no worker for intent=${decision.intent})`);
      await this._toDlq(streamId, raw, `no worker for intent=${decision.intent}`);
      await this._ack(streamId);
      this.metrics.dlq++;
      metrics?.brokerDlq.inc();
      return;
    }

    const t0  = Date.now();
    const out = await dispatch({ event, decision, breaker: this.breaker, timeoutMs: 8000 });
    const ms  = Date.now() - t0;

    if (out.ok) {
      this.log.log(`[stream-consumer] ${streamId} → processed by ${decision.worker.id} (${ms}ms)`);
      this.metrics.dispatched++;
      metrics?.brokerConsumed.inc({ topic: ROUTING_TOPIC, worker_id: decision.worker.id });
      metrics?.workerLatency.observe({ worker_id: decision.worker.id }, ms);
    } else {
      this.log.error(`[stream-consumer] ${streamId} → worker failed: ${out.error}`);
      await this._toDlq(streamId, raw, out.error);
      this.metrics.failed++;
      metrics?.brokerDlq.inc();
    }

    await this._ack(streamId);
  }

  async _ack(streamId) {
    try {
      await this.client.xack(ROUTING_TOPIC, CONSUMER_GROUP, streamId);
    } catch (e) {
      this.log.error('[stream-consumer] ACK failed:', e.message);
    }
  }

  async _toDlq(streamId, raw, reason) {
    try {
      await this.dlq.xadd(
        DLQ_TOPIC, 'MAXLEN', '~', '10000', '*',
        'originalStreamId', streamId,
        'component',        raw.component || 'unknown',
        'correlationId',    raw.correlationId || '',
        'timestamp',        new Date().toISOString(),
        'reason',           reason,
        'payload',          raw.payload || '{}'
      );
    } catch (e) {
      this.log.error('[stream-consumer] DLQ write failed:', e.message);
    }
  }

  snapshot() {
    return {
      running: this.running,
      topic:   ROUTING_TOPIC,
      group:   CONSUMER_GROUP,
      metrics: { ...this.metrics }
    };
  }
}

module.exports = { RedisStreamConsumer };
