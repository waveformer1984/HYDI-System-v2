# Proto YI Adapter Architecture

## Purpose

The `proto-yi` ProtoForge application is a thin orchestration wrapper around the existing Flask `Proto.I.Y` engine. The adapter layer ensures:

- No business logic (project creation, timeline computation, milestone scheduling) is duplicated.
- The Flask engine remains the source of truth for durable project and timeline data.
- ProtoForge owns the manifest, capabilities, lifecycle, event contracts, and diagnostics.
- The canonical ProtoForge event envelope is emitted for downstream HYDI consumers.

## Responsibility boundaries

| Layer | Owner | Responsibility | What it must NOT do |
|-------|-------|----------------|---------------------|
| **Next.js ProtoIY UI** | `apps/ursula-frontend/src/lib/protoi/` | Legacy presentation layer; user-facing forms, dashboard, task board | Call the Flask engine directly or store canonical data |
| **ProtoForge `proto-yi` wrapper** | `protoforge-applications/proto-yi/` | Orchestration, REST API, event emission, lifecycle, diagnostics, manifest | Implement project/timeline scheduling, persist a second copy of projects |
| **Proto.I.Y Engine Adapter** | `protoforge-applications/proto-yi/src/adapters/protoiy-engine.js` | Translate HTTP calls to/from the Flask engine; emit canonical events | Contain project/timeline business rules; write to RAW EVENT LEDGER directly |
| **HTTP Client** | `protoforge-applications/proto-yi/src/adapters/http-client.js` | Fetch/POST to the Flask engine | Interpret domain meaning |
| **Flask Proto.I.Y engine** | `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\proto_iy.py` | Durable project/timeline storage and computation (SQLite) | Emit HYDI events or implement a second event bus |
| **HYDI Event Gateway** | `protoforge/hydi-gateway/` | Ingest canonical events into RAW EVENT LEDGER | Run business logic |
| **CASCADE / KILO / Policy Engine** | `protoforge/cascade/`, `kilo/`, `lib/protoforge/` | Classify, hypothesize, and approve/reject events downstream | Create or modify project data |

## Adapter responsibilities

`src/adapters/protoiy-engine.js` is the single integration point to the Flask engine.

### Injected HTTP client

The adapter does not hard-code `fetch`. It accepts an object with `post(path, body)` and `get(path)` methods. In production the `FetchClient` from `src/adapters/http-client.js` is used. In tests, a fake client is injected. This keeps unit tests independent of the Flask service and the network.

### Methods

| Method | Engine call | Canonical event(s) emitted |
|--------|-------------|----------------------------|
| `createProject()` | `POST /proto_iy/project` | `project.created` |
| `getProject(id)` | `GET /proto_iy/project/:id` | none |
| `createTimeline()` | `POST /proto_iy/timeline` | `timeline.created`, `milestone.reached` (per milestone) |
| `getTimeline(projectId)` | `GET /proto_iy/timeline/:projectId` | none |
| `health()` | `GET /health` | none |

### Validation

The adapter validates the presence of required fields (`name`, `category`, `owner_id`, `milestones`, etc.) before calling the engine. Validation errors result in a `ValidationError` and a 400 response from the router.

## Event flow

```text
User / UI
  |
  v
POST /projects  (proto-yi Express API)
  |
  v
Repository.createProject()
  |
  v
ProtoIYEngineAdapter.createProject()
  |
  v
POST /proto_iy/project  (Flask engine)
  |
  v
SQLite `projects` table (source of truth)
  |
  v
ProtoIYEngineAdapter emits `project.created`
  |
  v
EventBus → MemoryTransport + FileTransport + ExternalAdapter
  |
  v
HYDI Event Gateway POST /events
  |
  v
RAW EVENT LEDGER
  |
  v
CASCADE → KILO → Policy Engine
```

The adapter never writes to the RAW EVENT LEDGER directly. Events are emitted through the shared `EventBus`, which the `ExternalAdapter` forwards to the HYDI Event Gateway when `EXTERNAL_ENDPOINT` is configured.

## Repository orchestration

`src/repository.js` keeps persistence separate from the engine:

- The in-memory/JSON store continues to own generic `Record` objects for backward compatibility with the ProtoForge blueprint.
- Project and timeline methods (`createProject`, `getProject`, `createTimeline`, `getTimeline`, `engineHealth`) are thin delegates to the adapter.
- No project/timeline data is duplicated in the store.
- The repository owns the `EventBus` reference, so the adapter can emit canonical events without needing direct access to the emission layer.

## Diagnostics

`src/diagnostics.js` follows the Resonate pattern:

```js
const { collectDiagnostics } = require('./diagnostics');
const diag = await collectDiagnostics(repository);
```

It reports:

- `ok` / `status` — overall health
- `manifest.loaded` — whether `manifest.json` is readable
- `manifest.capabilities` — capabilities declared in the manifest
- `manifest.eventsProduced` / `eventsConsumed` — event contracts
- `engine.configured` — whether the adapter is present
- `engine.reachable` — whether `GET /health` succeeds on the Flask engine
- `engine.endpoint` — the configured `PROTOIY_ENDPOINT`
- `engine.reason` — error message when unreachable
- `timestamp` — ISO 8601

The `GET /diagnostics` route in `src/api/router.js` exposes this for platform health monitoring.

## Future migration path

1. **Phase 1 (current):** Adapter reads/writes the Flask engine over HTTP. Canonical events are emitted. No duplication.
2. **Phase 2:** Add `GET /proto_iy/project/:id` and `GET /proto_iy/timeline/:projectId` routes to the Flask server (or add a lightweight Python REST wrapper) so the adapter can retrieve existing records. The engine remains the source of truth.
3. **Phase 3:** When the ProtoForge `proto-yi` domain model is ready, migrate the SQLite schema into a managed Supabase schema through a one-time ETL. The adapter becomes a policy-gated writer to the new store while the Flask engine is retired.
4. **Phase 4:** Update the Next.js ProtoIY UI to call the ProtoForge `proto-yi` REST API (`/projects`, `/projects/:id/timelines`) instead of the legacy in-memory `ProtoIStore`. The Flask engine and `protoi` routes can then be archived.

## Relationship to HYDI

- Proto YI is a ProtoForge application with a manifest, capabilities, and event contracts.
- It emits `project.created`, `timeline.created`, and `milestone.reached` through the ProtoForge `EventBus`.
- The `ExternalAdapter` forwards these to the HYDI Event Gateway when configured.
- Policy decisions (`protoforge.policy.approved`, `protoforge.policy.rejected`) are listed as consumed events for future integration.
- The RAW EVENT LEDGER remains the single source of truth for all event history.
