# Reserved Component Names

These names are reserved for canonical HYDI platform components. Do not use them for unrelated features, modules, tables, API routes, or UI components.

## Reserved canonical names

| Name | Canonical owner | Reason |
|---|---|---|
| **CASCADE** | `protoforge/cascade/` | Event processor, replay, lineage, derived store |
| **KILO** | `kilo/index.js` | Hypothesis generator |
| **Proto YI** | `protoforge/proto-yi/` (reserved) | Builder / integrator assistant |
| **Build a Mind** | `protoforge/build-a-mind/` (reserved) | Cognitive agent construction |
| **Forge Finder** | `protoforge/forge-finder/` (reserved) | Opportunity / blueprint discovery |
| **ProtoForge** | `lib/protoforge/` + `protoforge/` | Policy / governance DSL and platform blueprint tools |
| **RAW EVENT LEDGER** | `lib/protoforge/raw-ledger.ts` + `raw_event_ledger` table | Single source of truth |
| **HYDI Event Gateway** | `protoforge/hydi-gateway/` | Canonical ingestion point |
| **Policy Engine** | `lib/protoforge/policy-engine.js` | Canonical policy gate |
| **Replay Engine** | `protoforge/cascade/src/replay.js` | Canonical replay for derived events |
| **Lineage Graph** | `protoforge/cascade/src/derived-store.js` `LineageGraph` | Causal event relationships |
| **Knowledge Graph** | `src/memory/MemoryStore.js` / `pao-system/knowledge/` | Memory and facts (do not reuse for other graph types) |
| **Workflow Engine** | Not implemented | Reserved for future workflow orchestration |
| **Emission Layer** | `api/events/stream.js`, `lib/event-bus/` | Logic-free event publishing |

## Rules

1. **Exact match and case-insensitive match** are both reserved. Do not use `cascade`, `CASCADE`, `cascade-foo`, or `foo-cascade` for non-canonical code.
2. **No versioned suffixes** for the same concept. Use `cascadeVersion` inside `protoforge/cascade/` instead of `cascade-v2`.
3. **No new `EventBus`, `EventGateway`, `PolicyEngine`, `ReplayEngine`, or `Lineage` outside canonical paths.**
4. **Deprecated modules** must be renamed to `legacy-` or `legacy_*` when moved, or kept in `archive/`.

## Allowed but scoped

The following names are allowed because they are application-specific or already namespaced:

| Name | Allowed in | Reason |
|---|---|---|
| `EventBus` | `protoforge-applications/rezonate/src/events/event-bus.js` | In-app transport |
| `EventBus` | `switchboard/src/events/event-bus.js` | In-app transport |
| `EventBus` | `lib/event-bus/` | Shared TypeScript event bus for commercial projections |
| `HydiAdapter` | `switchboard/src/events/event-bus.js` | Switchboard-specific producer |
| `ExternalAdapter` | `protoforge-applications/rezonate/src/events/event-bus.js` | Resonate-specific producer |

## Consequences

Naming a new component with a reserved canonical name without an RFC will be rejected by `hdi-governance-gate.yml` CI and must be renamed before merge.
