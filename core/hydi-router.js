// core/hydi-router.js
//
// Backward-compatible facade. Existing callers (hydi-processor.js,
// protoforge-mock.js) use `routeEvent(event)` and expect `{ action, priority }`.
// New callers can use the singleton `router.route(event)` for capability-aware
// semantic routing with intent classification and circuit-breaker awareness.
//
// Old API (preserved):  routeEvent(event)        → { action, priority }
// New API:              router.route(event)      → { worker, intent, score, ... }
//                       router.registry          → CapabilityRegistry
//                       router.breaker           → CircuitBreaker

const { SemanticRouter } = require('./semantic-router');
const { CapabilityRegistry } = require('./capability-registry');
const { CircuitBreaker } = require('./circuit-breaker');
const { IntentClassifier } = require('./intent-classifier');

// ─── Legacy switch-based routing (PRESERVED for backwards compatibility) ────
// hydi-processor.js and any other current caller still get the {action, priority}
// shape they expect. Do NOT remove this — it's a load-bearing contract.
//
// Default behavior CHANGED on 2026-05-12: unknown types used to return
// `discard/none`, which silently dropped every event the semantic router
// introduced (outreach, cad, audio, ...). New default is `queue_worker/normal`
// so unknown types are persisted and a downstream worker can pick them up.
// If you genuinely want to drop something, set type = 'discard' explicitly.
function routeEvent(event) {
  switch (event.type) {
    case 'error':
      return { action: 'send_to_ai', priority: 'high' };
    case 'task':
      return { action: 'queue_worker', priority: 'normal' };
    case 'info':
      return { action: 'log_only', priority: 'low' };
    case 'discard':
      return { action: 'discard', priority: 'none' };
    default:
      // Open-ended types (outreach, cad, audio, analysis, ...) — queue them.
      return { action: 'queue_worker', priority: 'normal' };
  }
}

// ─── New capability-aware singleton router ──────────────────────────────────
// Shared instance so any module can register workers / observe breaker state.
const registry = new CapabilityRegistry();
const breaker = new CircuitBreaker({ threshold: 5, windowMs: 60_000, cooldownMs: 60_000 });
const classifier = new IntentClassifier();
const router = new SemanticRouter({ classifier, registry, breaker });

module.exports = {
  // Legacy
  routeEvent,
  // New surface
  router,
  registry,
  breaker,
  classifier,
  // Class exports for callers that want their own instances
  SemanticRouter,
  CapabilityRegistry,
  CircuitBreaker,
  IntentClassifier
};
