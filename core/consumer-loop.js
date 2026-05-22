// core/consumer-loop.js
//
// Polls hydi_events for pending rows, atomically claims each one, routes via
// the SemanticRouter, dispatches to the chosen worker, updates the row's
// status accordingly.
//
// Status transitions:
//   pending    → processing  (on claim)
//   processing → processed   (worker success)
//   processing → failed      (worker error, retry budget exhausted)
//   processing → dead_letter (no worker matched; action='dead_letter')
//
// Multi-instance safe: claiming uses an UPDATE ... WHERE status='pending'
// guard, so two consumer-loops racing for the same row will only let one win.
//
// Tunable env vars:
//   HYDI_CONSUMER_ENABLED=true|false   default false (opt-in)
//   HYDI_CONSUMER_BATCH=10             rows per poll
//   HYDI_CONSUMER_INTERVAL_MS=2000     sleep between polls when idle
//   HYDI_CONSUMER_TIMEOUT_MS=8000      per-event dispatch deadline

const { createClient } = require('@supabase/supabase-js');
const { dispatch } = require('./dispatcher');

// Metrics are optional — if prom-client isn't installed or the registry
// hasn't been set up yet, consumer-loop degrades gracefully.
let metrics;
try {
  metrics = require('./metrics');
} catch (_) {
  metrics = null;
}

class ConsumerLoop {
  constructor({ router, registry, breaker, supabase, logger = console } = {}) {
    if (!router || !registry || !breaker) {
      throw new Error('ConsumerLoop requires router, registry, breaker');
    }
    this.router = router;
    this.registry = registry;
    this.breaker = breaker;
    this.log = logger;
    this.supabase = supabase || createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.batch = parseInt(process.env.HYDI_CONSUMER_BATCH || '10', 10);
    this.intervalMs = parseInt(process.env.HYDI_CONSUMER_INTERVAL_MS || '2000', 10);
    this.timeoutMs = parseInt(process.env.HYDI_CONSUMER_TIMEOUT_MS || '8000', 10);
    this.running = false;
    this._stopRequested = false;
    this.metrics = {
      polls: 0,
      claimed: 0,
      processed: 0,
      failed: 0,
      deadLettered: 0,
      lastError: null,
      startedAt: null
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this._stopRequested = false;
    this.metrics.startedAt = new Date().toISOString();
    this.log.log(`[consumer] starting (batch=${this.batch}, intervalMs=${this.intervalMs})`);
    this._loop().catch((e) => {
      this.log.error('[consumer] loop crashed:', e);
      this.metrics.lastError = e.message;
      this.running = false;
    });
  }

  async stop() {
    this.log.log('[consumer] stop requested');
    this._stopRequested = true;
    // Wait up to 10s for in-flight work to finish
    const deadline = Date.now() + 10_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async _loop() {
    while (!this._stopRequested) {
      const pollN = ++this.metrics.polls;
      metrics?.consumerPolls.inc();
      let processedThisRound = 0;
      try {
        this.log.log(`[consumer] poll #${pollN}: querying hydi_events for status=pending limit=${this.batch}`);
        const t0 = Date.now();

        // 1. Pull a batch of pending events (no atomic claim yet — just preview)
        const { data: candidates, error } = await this.supabase
          .from('hydi_events')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(this.batch);

        const queryMs = Date.now() - t0;
        if (error) {
          this.log.error(`[consumer] poll #${pollN} query error after ${queryMs}ms:`, error.message);
          throw error;
        }

        this.log.log(`[consumer] poll #${pollN}: fetched ${candidates?.length ?? 0} candidates in ${queryMs}ms`);

        if (!candidates || candidates.length === 0) {
          await this._sleep(this.intervalMs);
          continue;
        }

        // 2. For each, try to claim atomically and process
        for (const ev of candidates) {
          if (this._stopRequested) break;
          // Normalise: event_id may be null for legacy rows; use integer id as claim key.
          // Also normalise type from event_type when type is missing/unknown.
          const claimKey = ev.event_id || ev.id;
          const displayType = (ev.type && ev.type !== 'unknown') ? ev.type : (ev.event_type || ev.type);
          this.log.log(`[consumer] poll #${pollN}: attempting claim ${claimKey} (type=${displayType})`);
          const claimed = await this._claim(ev.id, ev.event_id);
          if (!claimed) {
            this.log.log(`[consumer] poll #${pollN}: claim returned null for ${claimKey} (raced, or status check rejected)`);
            continue;
          }
          // Ensure normalised type is set on the claimed object for routing
          if (!claimed.type || claimed.type === 'unknown') {
            claimed.type = claimed.event_type || 'unknown';
          }
          this.metrics.claimed += 1;
          metrics?.eventsClaimed.inc();
          this.log.log(`[consumer] poll #${pollN}: CLAIMED ${claimKey}, handling...`);
          await this._handle(claimed);
          processedThisRound += 1;
        }
      } catch (e) {
        this.log.error(`[consumer] poll #${pollN} caught:`, e.message);
        this.metrics.lastError = e.message;
      }

      // Tight loop while there's work; back off when idle
      if (processedThisRound === 0) {
        await this._sleep(this.intervalMs);
      }
    }
    this.running = false;
    this.log.log('[consumer] stopped');
  }

  async _claim(rowId, eventId) {
    // Atomic-ish: only flip pending→processing if it's still pending.
    // We claim by the integer `id` (always populated) because `event_id` is a
    // UUID that may be null on legacy rows — Postgres evaluates
    // `WHERE event_id = NULL` as always-false, so eq('event_id', null) claims nothing.
    // Supabase doesn't expose true SELECT FOR UPDATE, but the conditional
    // update + RETURNING semantics give us safe-enough single-claim.
    const { data, error } = await this.supabase
      .from('hydi_events')
      .update({ status: 'processing' })
      .eq('id', rowId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (error) {
      this.log.error(`[consumer] claim error for id=${rowId} (event_id=${eventId}):`, error.message);
      return null;
    }
    return data; // null if someone else claimed first
  }

  async _handle(event) {
    // Use event_id when available; fall back to integer id for legacy rows.
    const label = event.event_id || `id:${event.id}`;
    let decision;
    try {
      decision = await this.router.route(event);
    } catch (e) {
      this.log.error(`[consumer] route error for ${label}:`, e.message);
      await this._mark(event.id, event.event_id, 'failed', {
        evaluation_context_snapshot: { failure_reason: `route error: ${e.message}` }
      });
      this.metrics.failed += 1;
      return;
    }

    // Dead-letter path: classifier ran but no worker exists
    if (decision.action === 'dead_letter' || !decision.worker) {
      this.log.log(`[consumer] ${label} → dead_letter (intent=${decision.intent}, conf=${decision.confidence?.toFixed(2)})`);
      await this._mark(event.id, event.event_id, 'dead_letter', {
        intent: decision.intent || null,
        evaluation_context_snapshot: {
          failure_reason: `no worker for intent=${decision.intent}`,
          route: decision
        }
      });
      this.metrics.deadLettered += 1;
      metrics?.eventsDeadLettered.inc();
      return;
    }

    const t0 = Date.now();
    const out = await dispatch({
      event,
      decision,
      breaker: this.breaker,
      timeoutMs: this.timeoutMs
    });
    const elapsedMs = Date.now() - t0;
    const workerId  = decision.worker.id;
    const eventType = event.type || 'unknown';

    if (out.ok) {
      this.log.log(`[consumer] ${label} → processed by ${workerId} (${out.elapsedMs}ms via ${out.transport})`);
      await this._mark(event.id, event.event_id, 'processed', {
        intent: decision.intent || null,
        evaluation_context_snapshot: {
          worker_id: workerId,
          intent: decision.intent,
          score: decision.score,
          transport: out.transport,
          elapsedMs: out.elapsedMs
        }
      });
      this.metrics.processed += 1;
      metrics?.eventsProcessed.inc({ worker_id: workerId, event_type: eventType });
      metrics?.workerLatency.observe({ worker_id: workerId }, elapsedMs);
    } else {
      this.log.log(`[consumer] ${label} → failed (${workerId}: ${out.error})`);
      await this._mark(event.id, event.event_id, 'failed', {
        intent: decision.intent || null,
        evaluation_context_snapshot: {
          failure_reason: out.error,
          worker_id: workerId,
          intent: decision.intent,
          score: decision.score,
          transport: out.transport
        }
      });
      this.metrics.failed += 1;
      metrics?.eventsFailed.inc({ worker_id: workerId, event_type: eventType });
    }
  }

  async _mark(rowId, eventId, status, extras = {}) {
    // Prefer event_id for the WHERE clause (stable UUID), fall back to integer id.
    const update = { status, ...extras };
    const { error } = await this.supabase
      .from('hydi_events')
      .update(update)
      .eq('id', rowId);
    if (error) this.log.error(`[consumer] mark ${status} failed for id=${rowId} (event_id=${eventId}):`, error.message);
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms).unref?.());
  }

  snapshot() {
    return {
      running: this.running,
      metrics: { ...this.metrics },
      config: {
        batch: this.batch,
        intervalMs: this.intervalMs,
        timeoutMs: this.timeoutMs
      }
    };
  }
}

module.exports = { ConsumerLoop };
