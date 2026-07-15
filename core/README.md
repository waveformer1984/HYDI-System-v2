# core/ — HYDI routing & dispatch

The `core/` directory holds the framework pieces that make HYDI a router instead of a script pile. Each file is small, single-responsibility, and composable.

## Files

| File | Role |
|------|------|
| `hydi-router.js` | Public facade. Exposes legacy `routeEvent()` + new singleton `router`, `registry`, `breaker`, `classifier`. **All other modules should import from here.** |
| `capability-registry.js` | `register({ id, domains, version, selfScore, endpoint })` / `find(domain)` / `list()`. Workers tell the system what they can handle. |
| `intent-classifier.js` | Maps `event → { intent, confidence, signals }`. Default is keyword + type-based. Pluggable for LLMs via `classifier.addClassifier(fn)`. |
| `semantic-router.js` | Composes classifier + registry + breaker into `route(event) → { worker, intent, score, reason }`. Scoring mirrors Heidi's `computeConfidence`. |
| `circuit-breaker.js` | Per-worker failure tracking. 5 failures in 60s → OPEN. Auto half-open after cooldown. |
| `dispatcher.js` | `dispatch({ event, decision, breaker, timeoutMs })`. Calls a worker via either in-process `execute()` or HTTP `endpoint`. 8s wall-clock cap. |
| `consumer-loop.js` | Polls `hydi_events` where `status='pending'`, claims atomically, routes, dispatches, updates status. Opt-in via `HYDI_CONSUMER_ENABLED=true`. |
| `test-router.js` | Smoke test for the registry + router (no DB). `node core/test-router.js`. |

## Boot order

1. `hydi-processor.js` (pm2 app `hydi-processor`) starts the HTTP service on `:3003`. It imports `core/hydi-router.js` and `core/consumer-loop.js`.
2. If `HYDI_CONSUMER_ENABLED=true`, the consumer loop starts polling. Otherwise it sits idle until you `POST /consumer/start`.
3. Workers (e.g. `workers/echo-worker.js`) come up, register themselves via `POST /registry/workers`, then wait for HTTP dispatches.
4. Events written to `hydi_events` with `status='pending'` get picked up by the consumer loop, routed to the best registered worker, dispatched, and marked `processed` / `failed` / `dead_letter`.

## Status lifecycle

```
pending → processing → processed   (success)
                    → failed       (worker error)
                    → dead_letter  (no worker registered for this intent)
```

## How to add a worker

**HTTP (recommended, matches pm2):** copy `workers/echo-worker.js`, change `doWork()`, point `WORKER_DOMAINS` at what it handles, run it. It self-registers at boot.

**In-process (for trusted, fast handlers):** in any file that runs inside the same node process as the consumer, `require('./core/hydi-router')` and call:

```js
const { registry } = require('./core/hydi-router');
registry.register({
  id: 'inline-logger',
  domains: ['log', 'info'],
  execute: async (event, decision) => {
    console.log('logged', event.event_id);
    return { ok: true };
  }
});
```

## Operating modes (Golden Rule alignment)

- **CLOSED breaker** → CLOSED operation: worker runs normally.
- **HALF_OPEN** → one tentative request decides whether to fully recover.
- **OPEN** → router refuses to dispatch; events to this worker's domain get rerouted or dead-lettered.

The consumer loop never deletes failed events. They persist in `hydi_events` with `status='failed'` and a `failure_reason`, so they're auditable and replayable via `replay-engine.js`.
