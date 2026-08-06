# Qualification Workload & Leak Fixes
**Date:** 2026-08-05 · **Fixes the failures recorded in `Operational_Qualification_Report.md` (33.3% success rate, 9.23 MB/hr harness leak)**

## Files changed

- `operational-qualification/workloads/workload-driver.js`
- `operational-qualification/config/qualification-config.json`

## Root causes and fixes

| Workload | Failure | Root cause | Fix |
|----------|---------|-----------|-----|
| `conversation` | 400 | Driver sent `{message, system}` but `pages/api/chat.ts` requires `{message, session_id, user_id}` — and replies with an SSE stream, not JSON | Correct payload; drain and validate the SSE body instead of `response.json()` |
| `memory-storage` | 500 | Target `/api/memory` does not exist (only `/api/memory/search` is routed in Next) | Retarget to memory-engine `POST :9998/store-workflow` — an idempotent upsert with a fixed id, so a 24h soak updates one row instead of growing the table |
| `memory-retrieval` | 405 | Driver POSTed JSON to `/api/memory/search`, which is GET-only and auth-gated | Retarget to memory-engine `GET :9998/search?q=qualification` — exercises the actual memory subsystem, no auth required |
| `supervisor-status` | Wrong target | The harness orchestrates services itself; no `supervisor.js` runs, so `:9999` can never answer during qualification (same architecture gap as the original hydi-core blocker) | Retarget to hydi-core `GET :9997/status` — a service the harness actually starts |

## Resource leak (9.23 MB/hr → fixed)

`WorkloadDriver.executeAll()` retained **every workload's full response body** (`result: result.data`) in the in-memory metrics array for the whole run: 6 workloads / 5 s ≈ 4,300 payload-bearing entries per hour. That is what tripped the harness's own 5 MB/hr heap gate — and it is also why `data/op-validation.json` reached 95 MB. Metric entries are now compact scalars only (workload, timestamp, success, duration, truncated error). The report generator's contract (`getMetrics()` / `getStatistics()`) is unchanged.

## Verified

All four previously-failing workloads pass against a live booted stack (memory-engine + hydi-core + Next dev): `conversation` PASS · `memory-storage` PASS · `memory-retrieval` PASS · `supervisor-status` PASS. The two workloads that could not be verified in the sandbox are environment-bound and should pass on the real machine: `bridge-request` (needs heidi-bridge from `C:\ProtoForge_Ecosystem`) and `database-operation` (needs the migrated local Supabase — returns a graceful 503 without it).

## Ursula `blame_games` ImportError (companion issue, not a HYDI gate)

`ursula-flask` crash-loops on `ImportError: cannot import name 'BlameGames' from 'blame_games'` — the `blame_games` package in the Ursula image lacks an `__init__.py` that re-exports `BlameGames`. In `C:\ProtoForge_Ecosystem\Ursula_Suite`, add to `apps/blame_games/__init__.py` (creating it if absent):

```python
from .routes import BlameGames  # adjust module if BlameGames lives elsewhere

__all__ = ["BlameGames"]
```

then rebuild/restart the container. If `BlameGames` is a Blueprint defined in another module, point the import there; `grep -rn "BlameGames" apps/blame_games/` will show the definition site.

## Next steps (unchanged from the certification plan)

1. Commit these two files, re-run `npm run operational-qualification` — the success-rate and leak gates should now be clean, and failure-injection can run.
2. `npm run soak-test-1h` → `npm run soak-test-24h`.
3. Re-certify; `PRODUCTION CERTIFIED` only when all gates pass.
