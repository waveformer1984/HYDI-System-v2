# Distributed worker authentication — security validation

## Threat model (Phase 2)

| Risk | Before audit | After hardening |
|------|--------------|-----------------|
| Concurrent state corruption | Last-write-wins on raw `save()` | `mutate()` + directory lock |
| Duplicate task claims | Possible under parallel `claimNext` | Serialized claim + lease guards |
| HMAC replay within window | Same token reusable | Per-request **JTI** + `auth_replay_used` cache |
| Timestamp drift / stale tokens | 10m informal window | Configurable skew (`HYDI_DISTRIBUTED_AUTH_SKEW_SEC`, default 120s) |
| Signature timing leaks | Plain compare | `crypto.timingSafeEqual` |
| Secret rotation | Single secret only | `HYDI_DISTRIBUTED_WORKER_SECRET_PREVIOUS` |

## Token format

- **v2 (preferred):** `v2:{workerId}:{unixTs}:{jti}:{hmacSha256Hex}`
- **v1 (legacy):** `{workerId}:{ts}:{sig}` — JTI derived from token hash for replay cache

Registration and authenticated calls must use **`consumeWorkerToken()`** inside a store `mutate()` so replay marks are durable.

## Failure classifications

| `classification` | Meaning |
|------------------|---------|
| `auth_ok` | Verified and consumed |
| `auth_malformed` | Unparseable token |
| `auth_expired` | Outside skew window |
| `auth_bad_signature` | HMAC mismatch |
| `auth_replay` | JTI already consumed |
| `auth_payload_mismatch` | Body `worker_id` ≠ token subject |

## Replay cache

- Stored in `state.auth_replay_used` (state v2)
- Pruned by `lib/distributed-cloud/replay-cache.js` (default retention 15 minutes)
- Bounded by time-based eviction, not unbounded growth under normal load

## Automated evidence

Run:

```bash
npx jest tests/unit/distributed-cloud-security.test.js tests/unit/distributed-cloud-concurrency.test.js --runInBand
```

Machine-readable summary: `/opt/cursor/artifacts/distributed-hardening-evidence.json` (generated on agent completion).

## Residual vulnerabilities

1. **Same-host lock only** — two hosts writing one NFS path without coherent locking can still corrupt state.
2. **File replay cache** — resetting `state.json` without backup clears replay memory (acceptable for dev; production should use durable coordination).
3. **v1 tokens** — weaker binding (no explicit JTI); migrate workers to v2.
4. **Worker secret on disk** — operator must protect env on Frank/GHA; not solvable in app code alone.

## Live verification blockers

- Cloud agent VM: auth/concurrency **VERIFIED SIMULATED** only
- Frank: **BLOCKED** (no tailnet path in agent environment)
- GHA: **CONFIGURED BUT UNTESTED** (workflow + secrets)