# Canonical Platform Components

## Canonical six-layer pipeline

```text
[1] Ingestion       → normalize structure only
[2] RAW LEDGER      → single source of truth
[3] CASCADE         → event processing (canonical)
[4] KILO            → hypothesis generator (canonical)
[5] ProtoForge      → policy gate (canonical)
[6] Emission        → SSE / API / logs
```

No layer may perform another layer's job.

## Canonical component map

| Canonical name | Path | Responsibility | Layer | Runtime owner |
|---|---|---|---|---|
| **HYDI Event Gateway** | `protoforge/hydi-gateway/` | Accepts canonical events from applications, writes to RAW LEDGER | 1 / 2 | `protoforge/hydi-gateway/` |
| **RAW Ledger Adapter** | `lib/protoforge/raw-ledger.ts` | Supabase append-only, hashed ledger | 2 | `lib/protoforge/` |
| **CASCADE** | `protoforge/cascade/` | Reads RAW LEDGER, validates, normalizes, derives events, lineage, metrics | 3 | `protoforge/cascade/` |
| **Derived Event Store** | `protoforge/cascade/src/derived-store.js` | Persistent derived event store + lineage graph | 3 | `protoforge/cascade/` |
| **CASCADE Replay Engine** | `protoforge/cascade/src/replay.js` | Replays RAW LEDGER from beginning, fingerprint, timestamp, or event type | 3 | `protoforge/cascade/` |
| **KILO** | `kilo/index.js` | Generates hypotheses; never executes | 4 | `kilo/` |
| **ProtoForge PolicyEngine** | `lib/protoforge/policy-engine.js` | Evaluates KILO hypotheses with DSL rules; fail-closed | 5 | `lib/protoforge/` |
| **ProtoForge Action Gate** | `lib/protoforge/action-gate.ts`, `lib/protoforge/auto-gate.js` | Runs PolicyEngine on KILO output before emission | 5 | `lib/protoforge/` |
| **Emission Layer** | `api/events/stream.js`, `lib/event-bus/`, SSE routes | Publishes approved events; no logic | 6 | `api/events/stream.js`, `lib/event-bus/` |
| **Chat Router** | `api/chat/route.js` | UI entry point for named agents; not a platform layer | N/A | `api/chat/` |

## Applications and adapters

| Application | Adapter | Target | Status |
|---|---|---|---|
| Resonate | `ExternalAdapter` in `protoforge-applications/rezonate/src/events/event-bus.js` | HYDI Event Gateway `POST /events` | Production |
| Switchboard | `HydiAdapter` in `switchboard/src/events/event-bus.js` | HYDI Event Gateway `POST /events` | Production |
| Proto YI | `ExternalAdapter` in `protoforge-applications/proto-yi/src/events/event-bus.js` | HYDI Event Gateway `POST /events` | Active (ProtoForge canonical application; see Phase 7.5b reconciliation) |

## Non-canonical but allowed components

These components are application-specific or legacy and do not need to be renamed, but they must not be mistaken for canonical platform services.

| Name | Path | Allowed because | Must not become |
|---|---|---|---|
| `EventBus` (Resonate) | `protoforge-applications/rezonate/src/events/event-bus.js` | In-app transport | Canonical event bus |
| `EventBus` (Switchboard) | `switchboard/src/events/event-bus.js` | In-app transport | Canonical event bus |
| `EventBus` (shared TS) | `lib/event-bus/` | Commercial projections | Platform layer |
| `KILO chat stub` | `api/chat/route.js` `handleKiloMessage` | UI placeholder | KILO runtime |

## Retired / reserved names

The following names should not be used for new components. Existing occurrences should be retired or renamed.

| Name | Current collision | Resolution |
|---|---|---|
| `CASCADE` in `modules/` | `modules/cascade-*.js` | Retire or move to `modules/legacy/` |
| `CASCADE` in chat | `api/chat/route.js` `handleCascadeMessage` | Rename to `LegacyCascadeChat` or remove |
| `KILO` chat stub | `api/chat/route.js` `handleKiloMessage` | Rename to `LegacyKiloChat` or remove |
| `ProtoForge` chat stub | `api/chat/route.js` `handleProtoForgeMessage` | Rename to `LegacyProtoForgeChat` or remove |
| `Replay Engine` (legacy) | `lib/protoforge/replay-engine.ts`, `lib/replay-engine.ts` | Mark `DEPRECATED`; use `protoforge/cascade/src/replay.js` |
| `Policy Engine` (legacy) | `keeper/policy-engine.js`, `keeper/policy/contextual-policy.js` | Retire; use `lib/protoforge/policy-engine.js` |
| `Raw Event Ledger` bridge | `modules/raw-event-ledger.js` | Retire; use `lib/protoforge/raw-ledger.ts` |

## Future component names (reserved)

These names are reserved for the next platform services. Do not reuse them for unrelated functionality.

| Reserved name | Purpose | Planned path |
|---|---|---|
| **KILO** | Hypothesis generator, already canonical | `kilo/` |
| **Proto YI** | ProtoForge project-management application | `protoforge-applications/proto-yi/` (active; legacy engine wrapped, not duplicated) |
| **Build a Mind** | Cognitive agent construction | `protoforge/build-a-mind/` (do not create yet) |
| **Forge Finder** | Opportunity / blueprint discovery | `protoforge/forge-finder/` (do not create yet) |
| **Hyve** | Swarm / opportunity collective | `hyve_service/` (existing, keep) |

## Forbidden for new components

Do not introduce:

- A second `CASCADE` outside `protoforge/cascade/`.
- A second `KILO` outside `kilo/`.
- A second `PolicyEngine` outside `lib/protoforge/policy-engine.js`.
- A second `ReplayEngine` outside `protoforge/cascade/src/replay.js`.
- Any new `Rule Engine` or `Workflow Engine` unless explicitly approved by an RFC.

## Testing ownership

Each canonical component owns its own `tests/` directory. The root `tests/unit/` contains legacy V2 tests and integration tests. New platform tests should live under the component directory (`protoforge/<component>/tests/`).
