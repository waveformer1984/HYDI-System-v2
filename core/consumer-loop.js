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
          this.log.log(`[consumer] poll #${pollN}: attempting claim ${ev.event_id} (type=${ev.type})`);
          const claimed = await this._claim(ev.event_id);
          if (!claimed) {
            this.log.log(`[consumer] poll #${pollN}: claim returned null for ${ev.event_id} (raced, or status check rejected)`);
            continue;
          }
          this.metrics.claimed += 1;
          this.log.log(`[consumer] poll #${pollN}: CLAIMED ${ev.event_id}, handling...`);
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

  async _claim(eventId) {
    // Atomic-ish: only flip pending→processing if it's still pending.
    // Supabase doesn't expose true SELECT FOR UPDATE here, but the conditional
    // update + RETURNING semantics give us safe-enough single-claim.
    const { data, error } = await this.supabase
      .from('hydi_events')
      .update({ status: 'processing' })
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (error) {
      this.log.error(`[consumer] claim error for ${eventId}:`, error.message);
      return null;
    }
    return data; // null if someone else claimed first
  }

  async _handle(event) {
    let decision;
    try {
      decision = await this.router.route(event);
    } catch (e) {
      this.log.error(`[consumer] route error for ${event.event_id}:`, e.message);
      await this._mark(event.event_id, 'failed', { failure_reason: `route error: ${e.message}` });
      this.metrics.failed += 1;
      return;
    }

    // Dead-letter path: classifier ran but no worker exists
    if (decision.action === 'dead_letter' || !decision.worker) {
      this.log.log(`[consumer] ${event.event_id} → dead_letter (intent=${decision.intent}, conf=${decision.confidence?.toFixed(2)})`);
      await this._mark(event.event_id, 'dead_letter', {
        failure_reason: `no worker for intent=${decision.intent}`,
        ai_analysis: JSON.stringify({ route: decision })
      });
      this.metrics.deadLettered += 1;
      return;
    }

    const out = await dispatch({
      event,
      decision,
      breaker: this.breaker,
      timeoutMs: this.timeoutMs
    });

    if (out.ok) {
      this.log.log(`[consumer] ${event.event_id} → processed by ${decision.worker.id} (${out.elapsedMs}ms via ${out.transport})`);
      await this._mark(event.event_id, 'processed', {
        ai_analysis: JSON.stringify({
          worker_id: decision.worker.id,
          intent: decision.intent,
          score: decision.score,
          transport: out.transport,
          elapsedMs: out.elapsedMs
        })
      });
      this.metrics.processed += 1;
    } else {
      this.log.log(`[consumer] ${event.event_id} → failed (${decision.worker.id}: ${out.error})`);
      await this._mark(event.event_id, 'failed', {
        failure_reason: out.error,
        ai_analysis: JSON.stringify({
          worker_id: decision.worker.id,
          intent: decision.intent,
          score: decision.score,
          transport: out.transport
        })
      });
      this.metrics.failed += 1;
    }
  }

  async _mark(eventId, status, extras = {}) {
    const update = { status, ...extras };
    const { error } = await this.supabase
      .from('hydi_events')
      .update(update)
      .eq('event_id', eventId);
    if (error) this.log.error(`[consumer] mark ${status} failed for ${eventId}:`, error.message);
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
