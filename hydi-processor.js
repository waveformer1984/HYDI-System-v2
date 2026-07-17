require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const { routeEvent } = require('./core/hydi-router');
// const { ChaosProxy } = require('./core/chaos-proxy'); // DISABLED

// HYDI Processor - Core Logic with Exponential Backoff
class HYDIProcessor {
  constructor() {
    // Supabase is OPTIONAL -- in local-only mode (no SUPABASE_URL/key set)
    // the event ledger write/read below degrade to console logging instead
    // of crashing. This class is constructed eagerly at module load (see
    // bottom of file), so an unconditional createClient() here would crash
    // any consumer that merely `require()`s this module, not just direct runs.
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    this.supabase = (process.env.SUPABASE_URL && SUPABASE_KEY)
      ? createClient(process.env.SUPABASE_URL, SUPABASE_KEY)
      : null;
    if (!this.supabase) {
      console.log('LOCAL-ONLY MODE: Supabase disabled — event ledger writes are console-logged, not persisted');
    }
    this.chaosMode = process.env.CHAOS_MODE || 'NONE';
  }

  async processEvent(source, type, payload) {
    const event = {
      event_id:   uuidv4(),
      source,
      type,         // normalized type (used by consumer router)
      event_type: type, // original event type column — NOT NULL in schema
      status:     'pending',
      payload,
      timestamp:  new Date().toISOString(),
      created_at: new Date().toISOString(),
      retry_count: 0
    };

    console.log(`PROCESSING: ${event.event_id} - ${type} from ${source}`);

    // Route the event (was silently missing — protoforge-mock expects result.route)
    const route = routeEvent(event);

    try {
      await this.writeEventWithRetry(event);
      return { success: true, event, route };
    } catch (error) {
      console.log(`FAILED: ${event.event_id} - ${error.message}`);
      return { success: false, error: error.message, event, route };
    }
  }

  async writeEventWithRetry(event, maxRetries = 3) {
    if (!this.supabase) {
      console.log(`LOCAL-ONLY MODE: event ${event.event_id} (${event.type} from ${event.source}) not persisted to hydi_events`);
      return { success: true, data: event };
    }

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`WRITE ATTEMPT: ${event.event_id} - attempt ${attempt + 1}/${maxRetries + 1}`);
        
        const { data, error } = await this.supabase
          .from('hydi_events')
          .insert([event])
          .select();

        if (error) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        console.log(`WRITE SUCCESS: ${event.event_id} - persisted on attempt ${attempt + 1}`);
        return { success: true, data: data[0] };

      } catch (error) {
        lastError = error;
        event.retry_count = attempt;

        console.log(`WRITE FAILED: ${event.event_id} - attempt ${attempt + 1} - ${error.message}`);

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`RETRY DELAY: ${event.event_id} - waiting ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          event.status = 'failed';
          // Store failure reason in evaluation_context_snapshot (jsonb) — failure_reason is not a DB column
          event.evaluation_context_snapshot = { failure_reason: lastError.message };
          console.log(`MAX RETRIES EXCEEDED: ${event.event_id} - marking as failed`);
        }
      }
    }
    
    throw lastError;
  }

  async getEventStats() {
    if (!this.supabase) {
      return { note: 'LOCAL-ONLY MODE: no Supabase-backed event ledger' };
    }

    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('status')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const stats = data.reduce((acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        return acc;
      }, {});

      return stats;
    } catch (error) {
      console.log('Stats query failed:', error.message);
      return { error: error.message };
    }
  }
}

// Export required functions (preserves backwards compat with protoforge-mock.js)
const processor = new HYDIProcessor();

module.exports = {
  processEvent: processor.processEvent.bind(processor),
  retryWrapper: processor.writeEventWithRetry.bind(processor),
  stateTracker: processor.getEventStats.bind(processor),
  HYDIProcessor // expose class for advanced use
};

// ─────────────────────────────────────────────────────────────────────────────
// DUAL-MODE RUNNER
// When required by another module (`require('./hydi-processor')`): library only.
// When run directly (`node hydi-processor.js`, or via pm2): start a long-lived
// management/ingestion service. This is what fixes the 309-restart pm2 loop —
// before, the script defined a class, exported functions, and exited cleanly
// with code 0, so pm2 thought it had crashed and kept restarting.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const express = require('express');
  const { router, registry, breaker } = require('./core/hydi-router');
  const { ConsumerLoop } = require('./core/consumer-loop');

  const app = express();
  app.use(express.json());

  const PORT = parseInt(process.env.PROCESSOR_PORT || '3003', 10);
  const startedAt = new Date().toISOString();

  // Single consumer loop instance shared across endpoints
  const consumer = new ConsumerLoop({ router, registry, breaker });

  // Health — pm2 / load balancers / cron probes
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'hydi-processor',
      pid: process.pid,
      startedAt,
      uptimeSec: Math.round(process.uptime()),
      chaosMode: processor.chaosMode,
      consumer: { running: consumer.running }
    });
  });

  // Stats — wraps the existing getEventStats()
  app.get('/stats', async (req, res) => {
    const stats = await processor.getEventStats();
    res.json({ ok: !stats.error, stats });
  });

  // Direct ingestion endpoint (alternate channel from protoforge-mock)
  // POST /ingest { source, type, payload }
  app.post('/ingest', async (req, res) => {
    const { source, type, payload } = req.body || {};
    if (!source || !type) {
      return res.status(400).json({
        ok: false,
        error: 'source and type are required'
      });
    }
    const result = await processor.processEvent(source, type, payload || {});
    res.status(result.success ? 200 : 500).json(result);
  });

  // ── Capability registry inspection ─────────────────────────────────────
  app.get('/registry', (req, res) => {
    res.json({
      workers: registry.snapshot(),
      breakers: breaker.snapshot()
    });
  });

  // POST /registry/workers { id, domains, version?, endpoint?, metadata? }
  // Registers an HTTP-dispatched worker. For in-process workers, register
  // programmatically by requiring the registry directly.
  app.post('/registry/workers', (req, res) => {
    try {
      const { id, domains, version, endpoint, metadata } = req.body || {};
      if (!id || !Array.isArray(domains) || !endpoint) {
        return res.status(400).json({
          ok: false,
          error: 'id, domains[], endpoint required'
        });
      }
      registry.register({
        id, domains, version: version || '0.0.0',
        endpoint,
        metadata: metadata || {}
      });
      res.json({ ok: true, worker: registry.get(id) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.delete('/registry/workers/:id', (req, res) => {
    const ok = registry.unregister(req.params.id);
    res.json({ ok });
  });

  // ── Consumer loop control ──────────────────────────────────────────────
  app.get('/consumer/status', (req, res) => res.json(consumer.snapshot()));

  app.post('/consumer/start', async (req, res) => {
    await consumer.start();
    res.json({ ok: true, running: consumer.running });
  });

  app.post('/consumer/stop', async (req, res) => {
    await consumer.stop();
    res.json({ ok: true, running: consumer.running });
  });

  // 404 fallthrough
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: `unknown route: ${req.method} ${req.path}` });
  });

  // Error handler — never let an unhandled promise crash the process silently
  app.use((err, req, res, next) => {
    console.error('UNHANDLED ERROR:', err);
    res.status(500).json({ ok: false, error: err.message });
  });

  const server = app.listen(PORT, () => {
    console.log(`HYDI-PROCESSOR service listening on :${PORT} (pid ${process.pid})`);
    console.log(`  GET  /health           — liveness probe`);
    console.log(`  GET  /stats            — last-100 events status counts`);
    console.log(`  POST /ingest           — { source, type, payload }`);
    console.log(`  GET  /registry         — workers + circuit breakers snapshot`);
    console.log(`  POST /registry/workers — { id, domains[], endpoint, ... }`);
    console.log(`  GET  /consumer/status  — consumer loop metrics`);
    console.log(`  POST /consumer/start   — start polling hydi_events`);
    console.log(`  POST /consumer/stop    — stop polling`);
  });

  // ── Register built-in workers ────────────────────────────────────────────
  // Workers are registered before the consumer starts so the first poll
  // already has a full registry. Add more by requiring from core/workers/.
  try {
    const systemMonitor   = require('./core/workers/system-monitor-worker');
    const stripeBilling   = require('./core/workers/stripe-billing-worker');
    const revenuePipeline = require('./core/workers/revenue-pipeline-worker');
    [systemMonitor, stripeBilling, revenuePipeline].forEach((w) => {
      registry.register(w);
      console.log(`  [registry] registered worker: ${w.id} (domains: ${w.domains.join(', ')})`);
    });
  } catch (e) {
    console.error('[registry] Failed to register built-in workers:', e.message);
  }

  // Auto-start the consumer loop if env says so. Default off so existing pm2
  // deployments don't get surprised by a new background loop. To enable:
  //   pm2 set HYDI_CONSUMER_ENABLED true  (or set in .env / ecosystem env)
  if (String(process.env.HYDI_CONSUMER_ENABLED || '').toLowerCase() === 'true') {
    consumer.start().catch((e) => {
      console.error('Consumer auto-start failed:', e);
    });
  } else {
    console.log('Consumer loop NOT auto-started (set HYDI_CONSUMER_ENABLED=true to enable).');
  }

  // Graceful shutdown — pm2 sends SIGINT/SIGTERM on stop/reload
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await consumer.stop().catch(() => {});
    server.close(() => {
      console.log('HTTP server closed. Goodbye.');
      process.exit(0);
    });
    // Force-exit after 12s (consumer.stop already waits up to 10s)
    setTimeout(() => {
      console.error('Forced exit after grace period.');
      process.exit(1);
    }, 12000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Surface unhandled rejections instead of swallowing them
  process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
  });
}
