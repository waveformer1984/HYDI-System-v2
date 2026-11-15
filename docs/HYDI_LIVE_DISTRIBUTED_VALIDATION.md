# HYDI Mission 2 — Live distributed execution validation

**Repository:** `waveformer1984/HYDI-System-v2`  
**Coordination:** [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587)  
**Prototype:** PR [#590](https://github.com/waveformer1984/HYDI-System-v2/pull/590)  
**Audit date:** 2026-11-15 (Cursor cloud agent VM)  
**Agent mode:** AUDIT-FIRST — no merge, deploy, secret rotation, or paid resources.

---

## Executive summary

| Goal | Status |
|------|--------|
| Operational distributed network (zero-cost) | **PARTIAL** — control plane works; live Frank worker **BLOCKED** |
| Live execution proof | **VERIFIED SIMULATED** on cloud VM; **VERIFIED LIVE** for remotive HTTP probe only |
| GHA worker | **CONFIGURED BUT UNTESTED** (workflow added; needs dispatch + secret) |
| Fabric unification | **Proposal only** — see `EXECUTION_FABRIC_UNIFICATION_PLAN.md` |

---

## Phase 1 — Architecture audit answers

| # | Question | Finding | Label |
|---|----------|---------|-------|
| 1 | Duplicate execution fabric? | **Partial overlap** — queue/registry duplicate; execution must stay on `ExecutionGateway` | Audit |
| 2 | File queue safe for concurrent workers? | **No** — load/mutate/save without file lock; last-write-wins proven in test | VERIFIED SIMULATED |
| 3 | Lease recovery after crash? | `reclaimExpiredLeases()` requeues expired claims; no RUNNING→FAILED path like fabric | VERIFIED SIMULATED |
| 4 | HMAC replay? | 10-minute timestamp window; no nonce store — **stale blocked**, **reuse within window possible** | VERIFIED SIMULATED |
| 5 | Idempotency across restart? | Same file dir reload dedupes `idempotency_key` | VERIFIED SIMULATED |
| 6 | History / transitions consistent? | `history[]` append; task `steps` not as rich as fabric | Audit gap |
| 7 | Mobile reflects execution? | `mobileSnapshot` reads same file store; **running Next on VM lacks route** until PR merged | CONFIGURED BUT UNTESTED |
| 8 | Real freelance sources? | Remotive **VERIFIED LIVE** from VM; full scout **VERIFIED SIMULATED** in tests | Mixed |

### PR compatibility matrix

| PR | State | vs #590 | Conflict / note |
|----|-------|---------|-----------------|
| #590 | Open | — | File queue prototype |
| #586 | **Merged** | None | Dev `/heidi` fix — helps mobile testing |
| #588 | Open | None | Audit docs only |
| #589 | Open | **Conceptual** | Revenue ops + mobile Revenue tab overlaps freelance presentation; unify via fabric plan |
| Intelligence branch | Pushed, no PR | Orthogonal | `MemoryRuntime` envelope; no queue collision until wired |

### Architectural conflicts

1. **Two mobile job surfaces:** `fabric.js` vs `distributed-jobs.js` — users may see divergent truth until unified.
2. **Two schedulers:** `hydi-schedulers.js` (local cron) vs distributed enqueue (not wired).
3. **Worker status:** `workers/lib/local-worker-status.json` vs distributed `state.json` workers array.
4. **V3 DistributedCompute:** used for scoring only; OperatorSession path does not use it in production (per phase27b report).

---

## Phase 2 — Frank / home connectivity (live probes)

| Check | Result | Label |
|-------|--------|-------|
| `tailscale` CLI | Not installed | BLOCKED |
| `heidi-pc.tailc50af2.ts.net` | DNS resolve failed | BLOCKED |
| Ollama `127.0.0.1:11434` | Connection refused | BLOCKED (on VM) |
| Frank PM2 / schedulers | Not reachable | BLOCKED |
| Cloud VM RAM | ~5.1 GiB available / 15 GiB; 4 vCPU; 239G disk free | VERIFIED LIVE |
| `GET localhost:3000/api/health` | HTTP 200 (degraded; Supabase local off) | VERIFIED LIVE (VM dev) |
| GitHub API (billing/actions) | HTTP 403 integration token | BLOCKED for quota read |

### Minimum Frank worker configuration

1. Shared `HYDI_DISTRIBUTED_WORKER_SECRET` on Frank and coordinator host.
2. `HYDI_REPO_ROOT` pointing at canonical tree on `clean-main`.
3. Outbound connectivity to coordinator (tailnet serve on loopback `:3471` or shared NFS path to **same** `state.json` — **REQUIRES_OPERATOR_APPROVAL** for shared filesystem).
4. PM2 or scheduled task running `node scripts/distributed-live-smoke.js` with `FRANK_WORKER=1` (diagnostic only).
5. Optional: `TS_AUTHKEY` on cloud agent for MCP read-only — does not execute workers.

See `docs/FRANK_DISTRIBUTED_WORKER_ACTIVATION.md`.

---

## Phase 3 — Smoke test

**Executed on cloud agent VM:** `node scripts/distributed-live-smoke.js` with `LIVE_NETWORK=1`.

| Step | Result |
|------|--------|
| Enqueue diagnostic job | OK |
| HMAC register + claim + complete | OK → `completed` |
| Mobile snapshot | 1 job visible |
| Remotive probe | HTTP 200 |

**Classification:** `VERIFIED_SIMULATED` (worker is VM, not Frank).  
**Evidence:** `.runtime/distributed-cloud/evidence/smoke-*.json` (also copied to artifacts).

**Frank live path:** **BLOCKED** — no tailnet.

---

## Phase 4 — GitHub Actions worker

- Workflow: `.github/workflows/distributed-cloud-worker-dispatch.yml`
- Proposal: `docs/GITHUB_ACTIONS_DISTRIBUTED_WORKER_PROPOSAL.md`
- **REQUIRES_OPERATOR_APPROVAL:** add secret + manual `workflow_dispatch`
- **Real GHA execution:** **CONFIGURED BUT UNTESTED** (workflow not on default branch until merge)

---

## Phase 5 — Fabric unification

See `docs/EXECUTION_FABRIC_UNIFICATION_PLAN.md`. **No Postgres migration** in this mission.

---

## Phase 6 — Freelance revenue

See `docs/FREELANCE_DISCOVERY_READINESS.md`.

---

## Deliverables index

| # | Deliverable | Path |
|---|-------------|------|
| 1 | Live infrastructure audit | This doc § Phase 2 |
| 2 | PR compatibility | This doc § Phase 1 matrix |
| 3 | Threat assessment | `DISTRIBUTED_CLOUD_THREAT_MODEL.md` + § HMAC replay gap |
| 4 | Frank worker activation | `FRANK_DISTRIBUTED_WORKER_ACTIVATION.md` |
| 5 | GHA worker proposal | `GITHUB_ACTIONS_DISTRIBUTED_WORKER_PROPOSAL.md` |
| 6 | Real execution evidence | `scripts/distributed-live-smoke.js` output + artifacts |
| 7 | Fabric unification | `EXECUTION_FABRIC_UNIFICATION_PLAN.md` |
| 8 | Freelance readiness | `FREELANCE_DISCOVERY_READINESS.md` |
| 9 | Zero-cost inventory | `DISTRIBUTED_CLOUD_RESOURCE_INVENTORY.md` (updated labels) |
| 10 | Follow-up PR plan | Below |

### Prioritized follow-up PR plan

1. **#590** + audit hardening — file lock or single-writer coordinator; nonce table for HMAC.
2. **Merge #589** after review — revenue presentation; link discover enqueue to control plane.
3. **Fabric adapter PR** — distributed enqueue → `ExecutionGateway` only.
4. **Frank validation PR** — operator-run smoke with `FRANK_WORKER=1` evidence attached to #587.
5. **GHA dispatch** — after secret set; attach artifact to issue.
6. Intelligence layer PR (existing branch) — after distributed store unified or clearly namespaced.

---

## Threat assessment addendum

| Risk | Severity | Mitigation status |
|------|----------|-------------------|
| Multi-writer JSON corruption | High | **Open** — document single coordinator |
| HMAC replay within 10 min | Medium | **Open** — add nonce / jti |
| Split brain mobile UIs | Medium | Unification plan |
| Scout live fetch ToS | Low | Read-only; operator owns compliance |