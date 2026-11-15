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