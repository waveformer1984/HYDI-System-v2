# HYDI Platform Component Reconciliation

## Executive summary

This audit inventories every component that touches the six-layer HYDI event pipeline and the surrounding platform surface. It identifies name collisions, duplicate responsibilities, stale prototypes, and canonical ownership. No application logic was modified.

## Method

Searched the repository for the following terms and their common aliases:

CASCADE, KILO, Proto YI, ProtoYI, ProtoForge, RAW EVENT LEDGER, Ledger, Event Gateway, EventBus, Rule Engine, Policy Engine, Workflow Engine, Replay, Replay Engine, Lineage, Knowledge Graph, Classification, Classifier, Confidence, Event Processor, Orchestrator, Adapter, Bridge.

Searched code, filenames, exports/imports, route handlers, READMEs, architecture docs, comments, TODOs, and the `archive/` and `src/` directories.

## Canonical six-layer pipeline

```text
[1] Ingestion     → structure only
[2] RAW LEDGER    → single source of truth
[3] CASCADE       → event processing / lineage
[4] KILO          → hypothesis generation
[5] ProtoForge    → policy gate
[6] Emission      → SSE / API / logs
```

## Component inventory

| Name | Path(s) | Purpose | Status | Consumers | Dependencies | Wired | Duplicate of | Should be canonical? | Action |
|---|---|---|---|---|---|---|---|---|---|
| **HYDI Event Gateway** | `protoforge/hydi-gateway/` | Canonical HTTP ingestion service for RAW LEDGER | Production | Resonate, Switchboard | `lib/protoforge/raw-ledger.ts`, Supabase | Yes | None | Yes | Keep |
| **Raw Ledger Adapter** | `lib/protoforge/raw-ledger.ts` | Supabase read/write for `raw_event_ledger` | Production | HYDI Event Gateway, CASCADE | Supabase | Yes | `modules/raw-event-ledger.js` | Yes | Keep; retire `modules/raw-event-ledger.js` |
| **CASCADE v1** | `protoforge/cascade/` | Canonical event processor: replay, normalize, lineage, derived store | Production | Future KILO, Proto YI, Build a Mind, Forge Finder | `lib/protoforge/raw-ledger.ts` (via LedgerAdapter) | New | `modules/cascade-*.js`, `api/chat/route.js` `handleCascadeMessage`, `archive/heidi-v2-dormant-pipeline/replay-family/cascade-classifier-v2.js` | **Yes (new canonical)** | Keep; rename/retire collisions |
| **CASCADE (legacy)** | `modules/cascade-event-intake.js`, `modules/cascade-core.js`, `modules/cascade-health-snapshot.js` | Event intake, classification, health snapshots for chat | Prototype / Dead | `api/chat/route.js` | Supabase | Partially | New `protoforge/cascade/` | No | Rename or retire |
| **CASCADE (chat stub)** | `api/chat/route.js` (`handleCascadeMessage`) | Chatbot facade that returns `classification` and `confidence` strings | Stub | Chat UI | Supabase `cascade_events` table | Yes | New `protoforge/cascade/` | No | Retire when chat moves to canonical CASCADE |
| **KILO** | `kilo/index.js`, `kilo.js` | Hypothesis generator; `execute()` throws by design | Active | `api/chat/route.js`, ProtoForge | None | Yes | `archive/heidi-v2-dormant-pipeline/replay-family/kilo-analyzer-v2.js` | Yes | Keep `kilo/index.js`; retire archives |
| **KILO (chat stub)** | `api/chat/route.js` (`handleKiloMessage`) | Chatbot facade for KILO | Stub | Chat UI | Supabase | Yes | `kilo/index.js` | No | Retire / delegate to `kilo/index.js` |
| **ProtoForge Policy Engine** | `lib/protoforge/policy-engine.js` | DSL policy gate; fail-closed | Production | `lib/protoforge/auto-gate.js`, KILO output | Supabase `policies` table | Yes | `archive/.../protoforge-policy-v2.js`, `keeper/policy-engine.js`, `keeper/policy/contextual-policy.js` | Yes | Keep; consolidate keeper copies |
| **Action Gate** | `lib/protoforge/action-gate.ts`, `lib/protoforge/auto-gate.js` | Wrapper that runs PolicyEngine on KILO output | Active | KILO → Policy | PolicyEngine | Yes | None | Yes | Keep |
| **ProtoForge (legacy chat stub)** | `api/chat/route.js` (`handleProtoForgeMessage`) | Chatbot facade for policy decisions | Stub | Chat UI | Supabase | Yes | `lib/protoforge/policy-engine.js` | No | Retire / use PolicyEngine |
| **EventBus (shared)** | `lib/event-bus/` | TypeScript event bus for commercial projections | Active | `lib/commercial/projections/`, `lib/ingress-adapter.ts` | None | Yes | None | Yes (shared) | Keep |
| **EventBus (Resonate)** | `protoforge-applications/rezonate/src/events/event-bus.js` | In-app event transport (Memory, File, External/HYDI) | Production | Resonate | HYDI Gateway | Yes | None (app-specific) | No (app-specific) | Keep |
| **EventBus (Switchboard)** | `switchboard/src/events/event-bus.js` | In-app event transport (Memory, File, HydiAdapter) | Production | Switchboard | HYDI Gateway | Yes | None (app-specific) | No (app-specific) | Keep |
| **Replay Engine (CASCADE)** | `protoforge/cascade/src/replay.js` | Replays RAW LEDGER for canonical derived events | Production | CASCADE v1 | `LedgerAdapter` | Yes | `lib/protoforge/replay-engine.ts`, `lib/replay-engine.ts`, `archive/.../replay-engine-v2.js` | **Yes (new canonical)** | Keep; retire older copies |
| **Replay Engine (V2)** | `lib/protoforge/replay-engine.ts`, `lib/replay-engine.ts` | TypeScript replay engine for V2 pipeline | Active | `tests/unit/replay-engine.test.ts`, V2 pipeline | Supabase | Yes (V2) | `protoforge/cascade/src/replay.js` | Partial (legacy V2) | Mark legacy; do not extend |
| **Heidi Orchestrator** | `src/orchestrator/HeidiOrchestrator.js` | V2 orchestrator | Active | `src/server.js` | Many | Yes | `heidi-core/`, `pao-system/core/heidi.controller.ts` | Partial (needs merge) | Merge into PAO `heidi.controller.ts` or retire |
| **PAO Controller** | `pao-system/core/heidi.controller.ts` | TypeScript central orchestrator for PAO | Active | PAO agents | Event bus | Yes | `src/orchestrator/HeidiOrchestrator.js` | Yes (preferred) | Keep; deprecate JS orchestrator |
| **Knowledge Graph** | `src/memory/MemoryStore.js`, `modules/...`, `heidi-core/seed-local-facts.js` | Memory/fact storage | Prototype / Active | `lib/claude.ts`, `src/control/...` | Supabase | Yes | Many `seed-local-facts` scripts | Partial | Audit separately |
| **Rule Engine (legacy)** | `src/models/local-model-adapter.js`, `src/middleware/model-rate-limiter.js`, `archive/.../keymaker-core.js` | Rate limiting / rule fragments | Dead / Archived | None | None | No | None | No | Retire |
| **Workflow Engine** | `apps/ursula-frontend/src/components/modules/InventoryModule.tsx` | UI mention only | Stub | None | None | No | None | No | Reserved name; do not use for non-workflow code |
| **Lineage (CASCADE)** | `protoforge/cascade/src/derived-store.js` `LineageGraph` | Parent/child/ancestor/descendant traversal | Production | CASCADE v1 API | DerivedStore | Yes | `stage4_..._broken_reality_fixes.sql`, `modules/event-integrity-firewall.js` (causality) | **Yes** | Keep |
| **Lineage (legacy)** | `modules/event-integrity-firewall.js` `cascade_prompt_v3.sql` | Integrity and causality rules in SQL/JS | Prototype | legacy V2 | Supabase | No | CASCADE LineageGraph | No | Retire |
| **Classification (legacy)** | `archive/.../cascade-classifier-v2.js`, `src/control/RealityFilter.js`, `src/control/OutcomeValidator.js` | Event classification / validation | Archived / Dead | None | None | No | New CASCADE | No | Archive |
| **Confidence / Classifier** | `src/control/RealityFilter.js`, `revenue-engine/reality-filter.js` | Confidence scoring, outcome validation | Dead / Prototype | `revenue-engine/` | None | Partial | New CASCADE metrics | No | Retire |
| **Bridge / Adapter (raw ledger)** | `modules/raw-event-ledger.js` | Older raw-event bridge | Dead | None | Supabase | No | `lib/protoforge/raw-ledger.ts` | No | Retire |
| **Bridge (chat)** | `api/chat/route.js` | Universal chat router to named agents | Active | Chat UI | Many | Yes | `pages/api/chat/route.js`? | Yes (chat entry) | Keep as chat router only; not a platform layer |

## Key findings

### 1. `CASCADE` name collision

The repository contains three distinct `CASCADE` implementations:

1. **Canonical** `protoforge/cascade/` — event processor, replay, lineage, derived store.
2. **Legacy** `modules/cascade-event-intake.js`, `modules/cascade-core.js` — event intake + classification for chat.
3. **Chat stub** `api/chat/route.js` `handleCascadeMessage` — returns `classification` and `confidence` strings and inserts into `cascade_events` table.

These are different responsibilities. The canonical `protoforge/cascade/` is the only component that should own `CASCADE` going forward.

### 2. `KILO` name collision

Two implementations:

1. **Canonical** `kilo/index.js` — standalone hypothesis generator, `execute()` throws.
2. **Chat stub** `api/chat/route.js` `handleKiloMessage` — returns hard-coded strings and calls `supabase.rpc('analyze_health_trends')`.

Keep `kilo/index.js`. The chat stub should delegate to it or be removed.

### 3. `Replay Engine` duplication

Four implementations:

1. `protoforge/cascade/src/replay.js` — canonical for ProtoForge event replay.
2. `lib/protoforge/replay-engine.ts` — V2 pipeline replay.
3. `lib/replay-engine.ts` — older variant.
4. `archive/heidi-v2-dormant-pipeline/replay-family/replay-engine-v2.js` — archived.

The canonical replay for new ProtoForge work is `protoforge/cascade/src/replay.js`. `lib/protoforge/replay-engine.ts` is legacy V2 and should not be extended.

### 4. `Policy Engine` duplication

Three implementations:

1. `lib/protoforge/policy-engine.js` — canonical DSL, fail-closed, hot-reload.
2. `keeper/policy-engine.js` / `keeper/policy/contextual-policy.js` — older keeper copies.
3. `archive/.../protoforge-policy-v2.js` — archived.

Canonical: `lib/protoforge/policy-engine.js`. Keeper copies should be retired.

### 5. `EventBus` multiplicity

- `lib/event-bus/` — shared TypeScript bus for commercial projections.
- `protoforge-applications/rezonate/src/events/event-bus.js` — Resonate in-app.
- `switchboard/src/events/event-bus.js` — Switchboard in-app.
- `lib/realtime/eventBus.js` — realtime variant.

These are application-specific or legacy; they do not collide because they are scoped to their package. No rename needed.

## Recommended canonical state

```text
Resonate ────┐
             ├──> HYDI Event Gateway ───> RAW EVENT LEDGER ───> CASCADE ───> KILO ───> ProtoForge PolicyEngine
Switchboard ──┘                                              │           │
                                                             v           v
                                                     Derived Events   Action Gate
```

All future consumers (Proto YI, Build a Mind, Forge Finder, Hyve) must read from CASCADE derived events, not the RAW LEDGER.

## Recommended renames / retirements

| From | To / Action | Rationale |
|---|---|---|
| `modules/cascade-event-intake.js` | `modules/legacy/cascade-event-intake.js` or delete | Obsoleted by `protoforge/cascade/` |
| `modules/cascade-core.js` | `modules/legacy/cascade-core.js` or delete | Obsoleted |
| `modules/cascade-health-snapshot.js` | `modules/legacy/cascade-health-snapshot.js` or delete | Obsoleted |
| `api/chat/route.js` `handleCascadeMessage` | Delegate to `protoforge/cascade/` or remove | Chat stub, not canonical |
| `api/chat/route.js` `handleKiloMessage` | Delegate to `kilo/index.js` or remove | Chat stub |
| `api/chat/route.js` `handleProtoForgeMessage` | Delegate to `lib/protoforge/policy-engine.js` or remove | Chat stub |
| `lib/protoforge/replay-engine.ts` | Mark `DEPRECATED` in README | Legacy V2 replay |
| `lib/replay-engine.ts` | Mark `DEPRECATED` or archive | Older variant |
| `keeper/policy-engine.js` | Retire | Duplicate of `lib/protoforge/policy-engine.js` |
| `keeper/policy/contextual-policy.js` | Retire | Duplicate |
| `modules/raw-event-ledger.js` | Retire | Duplicate of `lib/protoforge/raw-ledger.ts` |
| `archive/heidi-v2-dormant-pipeline/replay-family/*` | Keep in `archive/` | Already archived |

## Architecture diagrams

### Current state

```text
Applications (Resonate, Switchboard)
        |
        v
HYDI Event Gateway (protoforge/hydi-gateway/)
        |
        v
RAW EVENT LEDGER (lib/protoforge/raw-ledger.ts)
        |
        |<-- legacy: modules/cascade-*.js, api/chat cascade stub
        |
        v
CASCADE (protoforge/cascade/)      legacy CASCADE (modules/, api/chat)
        |                                |
        v                                v
Derived Store + Lineage          cascade_events table
        |                                |
        |<-- lib/protoforge/replay-engine.ts (legacy)
        |<-- archive/.../replay-engine-v2.js
        v
KILO (kilo/index.js)               KILO chat stub (api/chat)
        |                                |
        v                                v
PolicyEngine (lib/protoforge/)     keeper/policy-engine.js (legacy)
        |                                |
        v                                v
Emission (SSE/API/logs)            api/chat facade
```

### Recommended canonical state

```text
Resonate ────┐
Switchboard ──┤
              ├──> HYDI Event Gateway
Ursula/Chat ──┤      │
              │      v
              │  RAW EVENT LEDGER
              │      │
              │      v
              │  CASCADE (protoforge/cascade/)
              │      │
              │      v
              │  Derived Event Store / Lineage
              │      │
              │      v
              │  KILO (kilo/index.js)
              │      │
              │      v
              │  ProtoForge PolicyEngine
              │      │
              │      v
              └── Emission Layer
```

## No code changes

This audit produced documentation only. No application logic, tests, Supabase migrations, or UI components were modified.
