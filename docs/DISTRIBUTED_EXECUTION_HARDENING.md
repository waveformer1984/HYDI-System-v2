# Distributed execution hardening (Phase 2)

Coordinates with [issue #587](https://github.com/waveformer1984/HYDI-System-v2/issues/587) and PR #590.

## Scope

Harden the **file-backed** distributed control plane (`lib/distributed-cloud/`) for same-host multi-process workers before live activation. **Execution authority** remains `lib/execution-fabric/gateway.js` (`ExecutionGateway`); the distributed layer schedules, leases, and authenticates only.

## Phase 1 — Concurrency (closed in code)

| Control | Implementation |
|--------|----------------|
| Atomic writes | `atomicWrite()` — temp file + `rename` (`lib/distributed-cloud/store.js`) |
| Cross-process lock | Exclusive `.state.lock` via `wx` (`lib/distributed-cloud/lock.js`) |
| Lock timeout / stale recovery | `HYDI_DISTRIBUTED_LOCK_TIMEOUT_MS`, `HYDI_DISTRIBUTED_LOCK_STALE_MS`; stale PID probe |
| Read-modify-write | `DistributedCloudStore.mutate()` under lock |
| Duplicate claims | Re-check `QUEUED` + empty `lease_holder`; `lease_claim_token` on claim |
| Crash recovery | Lease reclaim (`reclaimExpiredLeases`); corrupt JSON → backup + empty state v2 |

**Multi-host:** **Not claimed.** Locking is **same-machine only** (shared filesystem). NFS or multi-host coordination requires Postgres or a dedicated lock service (out of scope for this PR).

## Phase 3 — Execution fabric adapter

`lib/distributed-cloud/fabric-adapter.js` maps only capabilities registered in `lib/execution-fabric/capabilities.js`. Example: `health.snapshot` → `health.check`. `job_scout.scan` stays **distributed worker execution** via `freelance-bridge` until a fabric capability exists.

`linkTaskToFabric()` calls `ExecutionGateway.submit()` — no second execution engine.

## Readiness matrix (operator)

| Surface | Classification | Notes |
|---------|----------------|-------|
| Local simulated worker | **VERIFIED SIMULATED** | Jest concurrency + acceptance suites on temp dirs |
| Frank worker | **BLOCKED** | Tailnet / host not reachable from cloud agent VM |
| GitHub Actions worker | **CONFIGURED BUT UNTESTED** | `distributed-cloud-worker-dispatch.yml` needs secret + manual dispatch |
| Cross-worker concurrency | **VERIFIED SIMULATED** | Parent/child process test + file lock |
| Authentication / replay | **VERIFIED SIMULATED** | `distributed-cloud-security.test.js` |
| Execution fabric integration | **VERIFIED SIMULATED** | `distributed-cloud-fabric-adapter.test.js` (link only; live probes may fail without services) |
| Mobile visibility | **VERIFIED SIMULATED** | `execution_authority` / `fabric_task_id` on public task rows |
| Freelance discovery / approval | **VERIFIED SIMULATED** | Acceptance #6–#8 |

## Frank / GHA activation

- **Frank:** **Not safe to activate** for live multi-worker until operator validates lock + auth on Frank’s filesystem and tailnet token is configured. Classification: **REQUIRES OPERATOR APPROVAL**.
- **GHA:** **Not safe for unattended live execution** until workflow is dispatched with rotated worker secret, replay cache is understood (state file must be durable on the runner host), and classification is **VERIFIED LIVE** on a test dispatch. Until then: **CONFIGURED BUT UNTESTED**.

## Tests

```bash
npx jest tests/unit/distributed-cloud*.test.js --runInBand --forceExit
```

## Environment

| Variable | Purpose |
|----------|---------|
| `HYDI_DISTRIBUTED_CLOUD_DIR` | State directory (never use production `.runtime/state.json`) |
| `HYDI_DISTRIBUTED_LOCK_TIMEOUT_MS` | Lock acquire timeout |
| `HYDI_DISTRIBUTED_LOCK_STALE_MS` | Stale lock break |
| `HYDI_DISTRIBUTED_AUTH_SKEW_SEC` | Timestamp skew (default 120) |
| `HYDI_DISTRIBUTED_WORKER_SECRET` | HMAC signing (server + worker) |
| `HYDI_DISTRIBUTED_WORKER_SECRET_PREVIOUS` | Rotation window |