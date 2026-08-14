# HYDI Phase 5 — Local-First Closure Audit

## Scope

This audit determines whether the entire HYDI control plane can operate without Supabase, and which subsystems still require it. It does not aim to migrate unrelated cloud code; it aims to establish a truthful boundary between what is already local-first and what is not.

## Audit method

1. Grep for `supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `createClient` in `api/`, `lib/`, `workers/`, `cascade/`, `protoforge/cascade/`.
2. Read representative health, worker, and persistence entry points.
3. Inspect `lib/health/collectors/database.ts` and `lib/health/collectors/workers.ts`.
4. Run `npm test` full suite to observe current regression baseline.

## Matrix: local-first vs. cloud-required

| Component | Local-first? | Cloud dependency | Evidence | No-Supabase behavior |
|---|---|---|---|---|
| HeidiController + PAO agents | **YES** | None | `pao-system/core/heidi.controller.ts` uses local agents; `lib/rezonate/rezonate-client.js` defaults to `json` store; `lib/apex/apex-client.js` uses local filesystem | Works |
| Apex Archive → Heidi bridge | **YES** | None | `tools/apex-archive-bridge.js` reads from local `hydi_outbox/` and calls `HeidiController` | Works |
| Rezonate canonical repository | **YES** | Optional `supabase` store type only if explicitly selected | `protoforge-applications/rezonate/src/persistence` defaults to `JsonStore` | Works |
| CASCADE (legacy `cascade/`) | **YES** (docs only) | None in this repo | `cascade/operation-perpetual-motion.md` is the only match; no runnable code | N/A |
| ProtoForge CASCADE (`protoforge/cascade/`) | **NO** — requires configuration but not necessarily runtime Supabase | Uses `lib/protoforge/policy-engine.js` and `lib/health/collectors/database.ts` | `protoforge/cascade/src/index.js`, `lib/protoforge/policy-engine.js` load rules/persistence from Supabase unless configured otherwise | Will fail unless policy and ledger are provided locally |
| Health API (`api/health.js`) | **NO** | Reads `system_dashboard` Supabase view | `api/health.js` | Fails or 503 without Supabase |
| `api/status/system.js` | **NO** | Uses `lib/server.ts` / `createClient` | `api/status/system.js` | Fails |
| `api/mobile-status.js` | **NO** | Uses `lib/server.ts` / `createClient` | `api/mobile-status.js` | Fails |
| `api/ursula/status.js` | **NO** | Uses `lib/server.ts` / `createClient` | `api/ursula/status.js` | Fails |
| `api/chat/route.js` | **NO** | Uses Supabase `memories` and `conversations` | `api/chat/route.js` | Fails |
| `api/revenue.js` | **NO** | Uses `lib/server.ts` and `revenue-engine/` | `api/revenue.js` | Fails |
| `api/heidi/route.js` | **NO** | Uses `lib/heidi-agent.ts` → `lib/server.ts` | `api/heidi/route.js` | Fails |
| Workers (`workers/*`) | **NO** | All 18 workers import `lib/server.ts` or `@supabase/supabase-js` | `workers/WorkerOrchestrator.js` | Fail on startup |
| Ledger (`lib/protoforge/raw-ledger.ts`, `revenue-engine/`) | **NO** | Supabase `raw_ledger` and `ledger` tables | `lib/protoforge/raw-ledger.ts` | Fails |
| Replay Engine | **NO** | Uses `lib/replay-engine.ts` → Supabase store | `lib/replay-engine.ts` | Fails |
| Ollama / local model | **YES** | Optional | `api/local-model.js` has a Supabase-less path but also reads status from Supabase | Degraded when Ollama is down; not blocked by Supabase |

## Key findings

1. The **Heidi → Apex → Rezonate → local persistence → audit** chain is already local-first. It does not use Supabase at runtime.
2. The **CASCADE, KILO, ProtoForge, workers, health APIs, revenue, chat, ledger, replay** subsystems are built around Supabase as a primary store. They cannot simply "not use it" without a local persistence fallback.
3. **Ollama unavailability** is a separate degraded state: the local model endpoint can work without Supabase, but other parts of the system may report degraded health through the cloud `system_dashboard` view.
4. **No direct fetch/axios to external cloud endpoints** was found in the Apex/Rezonate slice. The rest of HYDI uses `createClient` from `@supabase/supabase-js` or `lib/server.ts`.

## What must happen for full local-first closure

The smallest remaining blockers are not in the Apex/Rezonate slice. They are:

1. **Local policy store for ProtoForge**: `lib/protoforge/policy-engine.js` must be able to load rules from a local JSON/ledger file, not only `supabase.policies`.
2. **Local raw ledger for CASCADE**: `lib/protoforge/raw-ledger.ts` and `protoforge/cascade/src/index.js` need a local append-only file option.
3. **Local worker queue**: `lib/jobs/stores/SupabaseJobQueue.ts` is the only job queue. A `LocalJobQueue` store is required.
4. **Local health dashboard view**: `api/health.js`, `api/mobile-status.js`, `api/status/system.js`, and `api/ursula/status.js` must be able to read from a local `system_dashboard.json` or health aggregator, not only Supabase.
5. **Local chat memory**: `api/chat/route.js` uses Supabase `memories` and `conversations`. A local session store is required.

None of these are within the scope of the Apex/Rezonate operational slice, and migrating them would require an RFC and a dedicated migration phase.

## Conclusion for this slice

The local Apex + Rezonate control plane does **not** depend on Supabase. The rest of HYDI does. The local-first closure is not a code problem in this slice; it is a scope boundary. No code changes are necessary here to keep the local slice working. The truthful conclusion is that full HYDI is not yet local-first.
