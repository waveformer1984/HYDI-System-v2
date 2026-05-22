// core/workers/self-heal-worker.js
//
// Actuates operational course-corrections published by SelfReflectionEngine.
//
// Handled directives:
//   CRITICAL_DLQ_GROWTH          — log + alert (human escalation required)
//   RESOURCE_EXHAUSTION_RISK     — trigger V8 GC if --expose-gc is active
//   PIPELINE_STALL_DETECTED      — safely recycle the consumer loop (stop/start)
//                                   WITHOUT calling process.exit() — that would
//                                   kill the entire hydi-processor service.
//
// Worker contract:
//   id       : 'self-heal-worker'
//   domains  : ['self-heal']         ← SemanticRouter matches event.type
//   execute  : async (event) => {}   ← in-process dispatch (no HTTP endpoint)

'use strict';

// Consumer loop reference is injected at registration time via metadata.
// The processor passes { consumerRef, streamRef } so the worker can
// stop/start them without importing the processor module itself.
let _consumerRef  = null;
let _streamRef    = null;

const worker = {
  id:       'self-heal-worker',
  domains:  ['self-heal'],
  version:  '1.0.0',
  metadata: { description: 'Self-healing actuator — responds to SelfReflectionEngine directives' },

  // Called once by hydi-processor after registration to inject live references
  inject({ consumer, streamConsumer }) {
    _consumerRef = consumer;
    _streamRef   = streamConsumer;
  },

  async execute(event) {
    const { directive, meta } = event.payload || {};

    if (!directive) {
      console.warn('[self-heal] Received event without directive field — skipping');
      return { ok: true, skipped: true };
    }

    console.log(`[SELF-HEAL ACTUATOR] Processing directive: ${directive}`);

    switch (directive) {

      // ── DLQ growth ──────────────────────────────────────────────────────
      case 'CRITICAL_DLQ_GROWTH': {
        console.error(
          `[SELF-HEAL] 🚨 CRITICAL_DLQ_GROWTH — ${meta?.message}\n` +
          `  delta=${meta?.delta} total=${meta?.total}\n` +
          `  Action: ${meta?.actionRequired}\n` +
          `  ⚠️  Human review required — inspect hydi:dlq:deadletter for poison pills`
        );
        // Future: integrate PagerDuty / Slack webhook here
        return { ok: true, directive, action: 'logged_critical' };
      }

      // ── Socket / memory exhaustion ───────────────────────────────────────
      case 'RESOURCE_EXHAUSTION_RISK': {
        console.warn(`[SELF-HEAL] 🔧 RESOURCE_EXHAUSTION_RISK — ${meta?.message}`);
        if (typeof global.gc === 'function') {
          console.log('[SELF-HEAL] Invoking explicit V8 Garbage Collection...');
          global.gc();
          console.log('[SELF-HEAL] V8 GC completed.');
        } else {
          console.warn(
            '[SELF-HEAL] global.gc unavailable — start hydi-processor with --expose-gc to enable forced GC.\n' +
            '  pm2 ecosystem note: add `node_args: "--expose-gc"` to the hydi-processor entry.'
          );
        }
        return { ok: true, directive, action: 'gc_attempted' };
      }

      // ── Consumer loop stall ──────────────────────────────────────────────
      case 'PIPELINE_STALL_DETECTED': {
        console.error(`[SELF-HEAL] 🔄 PIPELINE_STALL_DETECTED — ${meta?.message}`);
        console.log('[SELF-HEAL] Recycling consumer loop (stop → start)...');

        let recycled = false;

        if (_consumerRef) {
          try {
            await _consumerRef.stop();
            await new Promise(r => setTimeout(r, 500));   // brief drain pause
            await _consumerRef.start();
            recycled = true;
            console.log('[SELF-HEAL] ✅ Supabase consumer loop recycled successfully.');
          } catch (e) {
            console.error('[SELF-HEAL] Consumer recycle error:', e.message);
          }
        } else {
          console.warn('[SELF-HEAL] No consumer reference injected — skipping recycle.');
        }

        if (_streamRef) {
          try {
            await _streamRef.stop();
            await new Promise(r => setTimeout(r, 500));
            await _streamRef.start();
            console.log('[SELF-HEAL] ✅ Redis stream consumer recycled successfully.');
          } catch (e) {
            console.error('[SELF-HEAL] Stream consumer recycle error:', e.message);
          }
        }

        return { ok: true, directive, action: recycled ? 'consumer_recycled' : 'recycle_skipped' };
      }

      default:
        console.log(`[SELF-HEAL] Directive "${directive}" received — no physical adjustment needed.`);
        return { ok: true, directive, action: 'no_op' };
    }
  }
};

module.exports = worker;
