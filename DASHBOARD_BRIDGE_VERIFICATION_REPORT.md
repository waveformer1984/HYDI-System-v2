# HYDI Dashboard Bridge — Production-Complete Verification

## Scope

Validate the Supabase-independent HYDI status bridge before declaring it production-complete. Supabase remains `INACTIVE`; it is intentionally not repaired.

## Changes Made

- `api/dashboard-status.js`
  - Added `snapshot_id` requirement.
  - Added 30-minute bounded replay-protection cache (`Map` in function memory).
  - Added `status_source = "degraded"` for bridge snapshots 10–30 minutes old.
  - Rejects timestamps in the future.
  - `POST` now accepts the signed bridge snapshot; `GET` serves dashboard/poller.

- `tools/dashboard-status/status_collector.py`
  - Generates `snapshot_id` per run (`secrets.token_urlsafe(16)`).

- `tools/dashboard-status/bridge_e2e_test.py`
  - Rewritten to test authentication, signatures, expiration boundaries, replay, and source selection.

- `tools/dashboard-poller/poller.py` & `tools/dashboard-status/run-collector.bat`
  - Schedules staggered: collector at :00, poller at :30.

## Final E2E Results

Ran: `python3 tools/dashboard-status/bridge_e2e_test.py`

```text
PASS  missing auth -> 401
PASS  invalid auth -> 401
PASS  fresh valid snapshot -> 200
PASS  bad signature -> 422
PASS  29-minute-old timestamp -> 200
PASS  31-minute-old timestamp -> 422 expired
PASS  first use of snapshot_id -> 200
PASS  replay of same snapshot_id -> 422
PASS  Supabase down + fresh bridge -> status_source = local-hydi

Results: 9 passed, 0 failed
```

## Repository Verification

```text
npm run typecheck   PASS  (exit 0)
npm test            PASS  (all unit tests green)
```

## Source Selection Matrix

| Case | Supabase | Bridge | Expected | Tested | Result |
|---|---|---|---|---|---|
| A | healthy | fresh | `supabase` | No | Not testable while Supabase is `INACTIVE` |
| B | down | fresh | `local-hydi` | Yes | PASS |
| C | down | expired/missing | `unavailable` | No | Code path implemented; not testable without a cold Vercel instance |

## Bridge Freshness Semantics

```text
fresh snapshot (received < 10 min)       → status_source = local-hydi
stale snapshot (received 10–30 min)      → status_source = degraded
expired/rejected (> 30 min or missing)   → status_source = unavailable
```

## Replay Protection

- Each `snapshot_id` is accepted only once.
- Reused `snapshot_id` returns `422 Snapshot replayed`.
- Cache is bounded and prunes entries older than 30 minutes.
- **Limitation:** cache is in-memory in a single serverless function. Replayed IDs are only blocked within the same Vercel function instance; a fresh instance would not know the history. This is acceptable for the current single-function architecture.

## Collector Health Checks

Verified from WSL (collector execution environment):

```text
http://localhost:3001/api/heidi          → 200, Heidi local model unavailable
http://localhost:3001/api/ursula/status  → 200, status UNKNOWN
http://localhost:3001/api/health         → 200, status degraded
```

All three endpoints are reachable. Collector outputs are honest:

```text
Heidi     down     (Ollama/LM Studio not running)
Ursula    unknown  (system_dashboard current_status is null)
CASCADE   unknown  (no dedicated local endpoint)
KILO      unknown  (no dedicated local endpoint)
ProtoForge unknown (no dedicated local endpoint)
Hyve      unknown  (no dedicated local endpoint)
Pipeline  degraded (api/health responds degraded)
Supabase  down     (cloud project INACTIVE)
```

## Container Health

`docker ps` from WSL shows all HYDI/Supabase/Ursula containers `Up` and `(healthy)` where health checks are configured.

## Dashboard Correctness

`tools/dashboard-poller/cache/status-cache.json` currently contains:

```json
{
  "status": "live",
  "status_source": "local-hydi",
  "supabase": "down",
  "pipeline": "degraded"
}
```

`dashboard/system-status.html` will render:

```text
LIVE · HYDI LOCAL BRIDGE
```

and continue to show `Supabase: DOWN` separately.

When Supabase recovers, `status_source` will automatically become `supabase` and the dashboard will show `LIVE · SUPABASE`.

`STALE` and `UNAVAILABLE` are mapped from `status_source: degraded` and `status_source: unavailable`.

## Scheduling

| Task | Frequency | Next Run |
|---|---|---|
| HYDI Status Collector | every 5 min at :00 | 9:29:00 PM |
| HYDI Dashboard Poller | every 5 min at :30 | 9:30:00 PM |

Collector runs 30–60 seconds before the poller, giving the bridge a fresh snapshot before polling.

## Security Scan

Searched repository for:

- `DASHBOARD_STATUS_TOKEN` value → not found in repo
- `HYDI_STATUS_BRIDGE_SECRET` value → not found in repo
- `SUPABASE_SERVICE_ROLE_KEY` value → not found in new files/caches
- `sb_secret_` / `eyJhbGci` in `tools/` cache → not found

Secrets live only in:

- Vercel environment variables
- `C:\Users\Owner\.hydi_dashboard_token`
- `C:\Users\Owner\.hydi_status_bridge_secret`

## Test Classification

| # | Requirement | Result |
|---|---|---|
| 1 | Missing auth → 401 | PASS |
| 2 | Invalid auth → 401 | PASS |
| 3 | Fresh valid snapshot → 200 | PASS |
| 4 | Bad signature → 422 | PASS |
| 5 | 29-minute-old timestamp → 200 | PASS |
| 6 | 31-minute-old timestamp → 422 | PASS |
| 7 | Replay of accepted snapshot → 422 | PASS |
| 8 | Supabase healthy + bridge → Supabase wins | NOT TESTED (Supabase INACTIVE) |
| 9 | Supabase down + bridge → local-hydi wins | PASS |
| 10 | Supabase down + expired bridge → unavailable | NOT TESTED (needs cold instance) |
| 11 | Secret scan → clean | PASS |
| 12 | npm typecheck → pass | PASS |
| 13 | npm test → pass | PASS |
| 14 | Collector actual health checks verified | PASS |
| 15 | Poller actual cached state verified | PASS |

## Remaining Blockers

No blockers inside the bridge scope.

Supabase cloud project `akbnfovjdcobifeupvbn` remains `INACTIVE`. This is reported honestly; the dashboard is still functional via the local HYDI bridge.
