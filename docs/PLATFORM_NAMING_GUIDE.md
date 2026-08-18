# Platform Naming Guide

## Goal

A single, unambiguous vocabulary for the HYDI platform. Every component has one canonical name, one owner path, and zero aliases.

## Canonical naming table

| Canonical name | Existing aliases | Path | Status | Collisions |
|---|---|---|---|---|
| **CASCADE** | `cascade` in `modules/`, `api/chat` | `protoforge/cascade/` | Active | `modules/cascade-*.js` (legacy) |
| **KILO** | `kilo` chat handler in `api/chat/route.js` | `kilo/index.js` | Active | `api/chat` stub |
| **Proto YI** | `ProtoYI`, `Proto.I.Y`, `protoi`, `proto_iy` | `protoforge-applications/proto-yi/` | Active | `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\` (legacy Flask engine), `apps/ursula-frontend/src/lib/protoi/` (legacy Next.js UI) |
| **ProtoForge** | `protoforge` CLI, `lib/protoforge/`, `protoforge-applications/` | `lib/protoforge/` + `protoforge/` | Active | None (shared brand) |
| **RAW EVENT LEDGER** | `raw_event_ledger`, `raw-event-ledger`, `ledger` | `supabase/migrations/20260714120000_raw_event_ledger_table.sql`, `lib/protoforge/raw-ledger.ts` | Active | `modules/raw-event-ledger.js` |
| **HYDI Event Gateway** | `hydi-gateway`, `Event Gateway` | `protoforge/hydi-gateway/` | Active | None |
| **Replay Engine** | `replay-engine` in `lib/protoforge/`, `lib/`, archive | `protoforge/cascade/src/replay.js` | Active | `lib/protoforge/replay-engine.ts` |
| **Lineage** | `lineage` in SQL/JS, `cascade_prompt_v3.sql` | `protoforge/cascade/src/derived-store.js` `LineageGraph` | Active | Legacy SQL/JS references |
| **Policy Engine** | `policy-engine`, `contextual-policy`, `protoforge-policy-v2` | `lib/protoforge/policy-engine.js` | Active | `keeper/policy-engine.js` |
| **Action Gate** | `action-gate`, `auto-gate` | `lib/protoforge/action-gate.ts`, `lib/protoforge/auto-gate.js` | Active | None |
| **EventBus** | `event-bus`, `EventBus.ts`, `eventBus.js` | package-specific | Active (multiple scopes) | Resonate, Switchboard, shared TS, realtime JS |
| **Orchestrator** | `HeidiOrchestrator.js`, `heidi.controller.ts`, `orchestrator.ts` | `pao-system/core/heidi.controller.ts` | Active | `src/orchestrator/` |
| **Hyve** | `hyve`, `hyve_service/` | `hyve_service/` | Active | None |
| **Resonate** | `rezonate` | `protoforge-applications/rezonate/` | Active | None |
| **Switchboard** | `switchboard` | `switchboard/` | Active | None |
| **Ursula** | `ursula` | `apps/ursula-frontend/`, `ursula-suite/` | Active | Local Python suite vs Next.js app |

## Naming rules

1. **Canonical names are capitalized** when they refer to a platform component: CASCADE, KILO, Proto YI, ProtoForge, HYDI.
2. **Directory names are lower-case-kebab** for packages: `protoforge/cascade/`, `kilo/`, `protoforge/hydi-gateway/`.
3. **File names are lower-case-kebab** unless they are classes: `policy-engine.js` not `PolicyEngine.js`.
4. **Do not use `cascade`, `kilo`, `protoforge` as prefixes for unrelated features.**
5. **Do not create `CASCADE-2`, `KILO-v2`, etc.** Versioning is handled inside the component (`version` field, schema adapters).
6. **Legacy aliases must be renamed or moved to `archive/` within one release cycle.**

## Collision resolution plan

| Collision | Resolution | Owner |
|---|---|---|
| `modules/cascade-*.js` | Rename to `modules/legacy/cascade-*.js` or delete | Platform team |
| `api/chat` `handleCascadeMessage` | Rename to `handleLegacyCascadeChat` or remove | Frontend team |
| `api/chat` `handleKiloMessage` | Rename to `handleLegacyKiloChat` or remove | Frontend team |
| `api/chat` `handleProtoForgeMessage` | Rename to `handleLegacyProtoForgeChat` or remove | Frontend team |
| `lib/protoforge/replay-engine.ts` | Add `DEPRECATED.md` and rename to `replay-engine-legacy.ts` | V2 maintenance team |
| `lib/replay-engine.ts` | Archive | V2 maintenance team |
| `keeper/policy-engine.js` | Delete; import from `lib/protoforge/policy-engine.js` | Keeper team |
| `modules/raw-event-ledger.js` | Delete; use `lib/protoforge/raw-ledger.ts` | Platform team |

## Future reserved names

The following names are reserved and may not be used for any other purpose:

- `KILO` — hypothesis generator
- `Proto YI` — builder / integrator assistant
- `Build a Mind` — cognitive agent construction
- `Forge Finder` — opportunity / blueprint discovery
- `CASCADE` — canonical event processor
- `ProtoForge` — policy / governance layer
- `HYVE` — swarm / opportunity collective

## Glossary

- **CASCADE** — canonical event processing layer; validates, normalizes, derives, lineage.
- **KILO** — hypothesis generator only; never executes.
- **Proto YI** — (reserved) builder/integrator assistant.
- **Build a Mind** — (reserved) cognitive agent construction.
- **Forge Finder** — (reserved) opportunity discovery.
- **ProtoForge** — policy/governance layer; DSL rule engine.
- **HYVE** — opportunity collective / swarm.
- **RAW EVENT LEDGER** — single source of truth; immutable, append-only.
- **HYDI Event Gateway** — canonical ingestion point.
- **Emission Layer** — logic-free publishing of approved events.
