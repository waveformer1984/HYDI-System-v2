# HYDI master architecture audit

**Branch audited:** `clean-main` + reference PR #590 (distributed)  
**Authority:** `lib/execution-fabric/gateway.js` (`ExecutionGateway`) for mobile ops execution  
**Date:** 2026-11-15 UTC

## Executive summary

HYDI is a **multi-surface** system: six-layer pipeline (protoforge-core), Next.js web/mobile BFF, heidi-core missions, PAO TypeScript agents, WorkerOrchestrator pollers, Supabase edge functions, and optional distributed file control plane (PR #590). **Duplication risk** is highest at task/queue boundaries — mitigated by routing new execution through ExecutionGateway and distributed scheduling only where explicitly designed.

## Subsystem map

| Subsystem | Location | Role |
|-----------|----------|------|
| Heidi UI / chat | `pages/`, `heidi-core/` | Conversational ops, missions |
| Mobile BFF | `pages/api/heidi-mobile/*` | Pairing, fabric, distributed-jobs (PR #590) |
| Execution fabric | `lib/execution-fabric/` | **Canonical execution** |
| Mobile ops | `lib/mobile-ops/` | Typed actions + job catalog |
| Pipeline | `lib/pipeline/`, `modules/cascade-*` | Six-layer contract |
| ProtoForge | `lib/protoforge/` | Policy gate (fail-closed) |
| KILO | `kilo/` | Hypotheses only |
| Model stack | `lib/ModelManager.ts`, Ollama | Inference routing |
| Paid gate | `lib/cost/paid-llm-gate.js` | $0 default |
| PAO agents | `pao-system/` | Business TS agents (separate registry) |
| Workers | `workers/` | Supabase queue pollers |
| V3 executive | `src/hydi-v3/` | Legacy/alternate ExecutionGateway (isolated tests) |
| Distributed cloud | `lib/distributed-cloud/` (PR #590) | Worker queue, not second executor |

## Duplication and disconnects

| Issue | Severity | Mitigation |
|-------|----------|------------|
| `src/hydi-v3/ExecutionGateway` vs `lib/execution-fabric/gateway.js` | Medium | Document: fabric is production mobile path; V3 is executive simulation suite |
| `pao-system` task router vs fabric gateway | Medium | New workforce uses `lib/dev-workforce/coordinator.js` → fabric only |
| heidi-core missions vs fabric tasks | Low | Missions for human approval lifecycle; fabric for typed capabilities |
| Supabase action queues vs file distributed queue | Medium | PR #590 adapter maps select actions to fabric; scout stays worker-local |
| Multiple health endpoints | Low | `system_dashboard` view is authoritative for aggregate health |

## Bottlenecks

- **Frank single host** — PM2, memory pressure, disk guard  
- **PM2 jlist latency** — blocks health truth (`lib/runtime/collect.js`)  
- **Supabase optional** — local-first path must stay viable  
- **Same-host file lock** — distributed state not multi-datacenter (PR #590)

## Missing integration pathways

1. **OpenAI Responses API** — `lib/providers/openai-adapter.js` (mock-first on master mission branch)  
2. **Job scout → fabric capability** — not registered in `capabilities.js` yet; distributed bridge only  
3. **Multi-agent dev workforce → mobile UI** — registry exists; API surface not wired (future)  
4. **GHA worker** — workflow on PR #590 untested  

## Safe improvements implemented (master mission)

- `lib/providers/openai-adapter.js` — mock mode default  
- `lib/dev-workforce/*` — typed agents → ExecutionGateway  

## Recommendations (no RFC unless pipeline touch)

1. Register `job_scout_scan` in fabric only after allowlist runner is unified  
2. Keep distributed cloud as **scheduler**; never execute business logic there  
3. Consolidate agent registry documentation (PAO vs dev-workforce vs distributed workers)

**Classification:** VERIFIED SIMULATED (static audit + unit tests)

---

## Appendix — detailed findings ([Architecture audit for docs](bc-3510de1d-4286-556f-b786-e5ffcb833601))

**Canonical authority:** `lib/execution-fabric/gateway.js` (`getExecutionGateway()`). **Not** `src/hydi-v3/ExecutionGateway.js` (business console / operator CLI).

### Execution path matrix

| # | Path | Entry | Durable store | Canonical for host ops? |
|---|------|-------|---------------|-------------------------|
| A | Execution fabric | `/api/mobile-ops/fabric` | `execution_fabric_tasks` / memory | **Yes** |
| B | heidi-core missions | `/chat-tools`, mission-worker | SQLite missions | Domain (local autonomy) |
| C | Chat `ActionExecutor` | `/api/chat` tools | Supabase `actions` | Governed chokepoint |
| D | HumanActionEngine | `/api/goals` | `human-actions.json` + mirror | Governed multi-step |
| E | V3 ExecutionGateway | `scripts/operator-cli.js` | V3 data dir | Simulation / business OS |
| F | Worker queues | `WorkerOrchestrator` | Supabase or local JSON | Async domain |
| G | Edge `action-worker` | Cron | `operator_actions` | Legacy operator queue |
| H | distributed-cloud | (PR #590) | File store | **Schedule only** → A |

### Top integration gaps

- `/api/goals` and missions do not always call `gateway.submit()` — mobile fabric is canonical for **typed host ops**.
- ProtoForge escalated actions (`pages/api/actions/*`) vs fabric approve — separate surfaces.
- `lib/distributed-cloud/` only on PR #590; fabric adapter map is intentionally tiny until capabilities registered.
- Paid-LLM: some paths still read keys directly (`lib/claude.ts`, `pages/api/funding/chat.ts`) — audit as security debt vs `paid-llm-gate.js`.

### Top bottlenecks

- Fabric singleton per Node process — split brain without Postgres persist.
- `job-manager.js`: `MAX_RUNNING = 2`, in-memory logs, lost on restart.
- `system_dashboard` / Supabase health — 503 when DB unhealthy.
- Dual Ollama clients: `lib/ModelManager.ts` vs `heidi-core/brain/ollama-client.js`.

### Partnerships & workforce (post-audit wiring)

- **Partnerships pipeline** (`lib/partnerships-funding/`, PR #593) — research/drafts; no execution engine.
- **Dev workforce** (`lib/dev-workforce/coordinator.js`) — `submit()` only; privileged caps gated until `HYDI_WORKFORCE_DISTRIBUTED_READY`.

### Test map (quick)

`tests/unit/execution-fabric-*.test.js` · `tests/unit/heidi-mobile-api.test.js` · `tests/unit/pipeline-replay.test.js` · `tests/unit/distributed-cloud*.test.js` (PR #590) · `tests/unit/partnerships-funding.test.js` (PR #593)