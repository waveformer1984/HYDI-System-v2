# Verification report — distributed cloud prototype

| # | Acceptance criterion | Mode | Result |
|---|----------------------|------|--------|
| 1 | Control plane up with home offline | SIMULATED | PASS — `status()` healthy with 0 workers |
| 2 | Tasks persist without workers | SIMULATED | PASS — file store reload |
| 3 | Cloud worker completes lightweight task | SIMULATED | PASS |
| 4 | Home worker resumes after reconnect | SIMULATED | PASS — register + claim |
| 5 | Duplicate execution prevented | SIMULATED | PASS — completion idempotency |
| 6 | Freelance discovery without home PC | SIMULATED | PASS — `runScout` + fixtures |
| 7 | Mobile reflects durable jobs | SIMULATED | PASS — `mobileSnapshot` |
| 8 | Approval blocks external actions | SIMULATED | PASS |
| 9 | Quota exhaustion fails safe | SIMULATED | PASS |
| 10 | No unauthorized paid spend | SIMULATED | PASS |

**Command:** `npx jest tests/unit/distributed-cloud-acceptance.test.js --forceExit`  
**Result:** 11/11 PASS (2026-11-15 agent VM)

## Not verified (honest gaps)

- Live GitHub Actions worker executing on `ubuntu-latest` against production secrets
- Frank home worker over Tailscale with real `PROTOFORGE_MCP_TOKEN`
- Postgres-backed queue with execution fabric `EXECUTION_FABRIC_PERSIST=postgres`
- Real Cloudflare Worker deploy (secrets not assumed present)

## Remaining blockers

1. Operator approval to enable scheduled enqueue from `hydi-schedulers` → control plane.
2. Optional `TS_AUTHKEY` for tailnet worker pull against Frank-hosted control plane.
3. Merge strategy for open PRs (#586 audit docs, revenue-ops) without violating audit mode.
4. Issue #587 thread update (GitHub integration token could not comment in prior run).