# HYDI Phase 12 — Health Architecture

## Status Vocabulary

All local health probes return exactly one of:

- `HEALTHY` — service is reachable and operational.
- `DEGRADED` — service is reachable but returning errors or slow.
- `UNAVAILABLE` — service is expected but not reachable.
- `NOT_CONFIGURED` — the component is optional and not enabled locally.

`NOT_CONFIGURED` and `UNAVAILABLE` must not collapse the overall local system status to `UNHEALTHY`.

## Probes Added

| Probe | Method | Optional? | Failure without probe is fatal? |
|---|---|---|---|
| `persistence` | `fetch` to local Supabase REST | no | yes |
| `postgres` | `docker ps` for `supabase_db_*` | no | yes |
| `ollama` | `fetch` to `LOCAL_MODEL_URL` | yes | no |
| `docker` | `docker version` | no (for containerized stack) | yes, if docker is expected |
| `workers` | placeholder / future queue monitor | yes | no |
| `controlPlane` | in-memory self-check | no | yes |

## Source

`src/heidi-executive/LocalHealthProbes.js`

- Constructor accepts `supabaseUrl`, `ollamaUrl`, `fetch`, and `execFile` for testability.
- `registerWith(healthAggregator, options)` wires probes into the existing `HealthAggregator`.
- No external internet probes are performed.

## Integration

```js
const { HealthAggregator, LocalHealthProbes, registerWith } = require('./src/heidi-executive');
const health = new HealthAggregator();
registerWith(health, { supabaseUrl: 'http://127.0.0.1:54321' });
const results = await health.inspectAll();
```

## Tests

`tests/unit/heidi-executive/phase12-autonomous.test.js`:

- healthy response → `HEALTHY`
- fetch error → `UNAVAILABLE`
- unexpected status code → `DEGRADED`
- Ollama disabled → `NOT_CONFIGURED`
- Docker absent → `NOT_CONFIGURED`
