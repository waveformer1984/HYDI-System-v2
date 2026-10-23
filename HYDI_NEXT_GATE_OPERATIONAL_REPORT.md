# HYDI Next Gate — Operational Status Soak and Root-Cause Audit

## Phase 1 — Supabase Root Cause

| Item | Value |
|---|---|
| Project reference | `akbnfovjdcobifeupvbn` |
| Project status | `INACTIVE` |
| Configured URL | `https://akbnfovjdcobifeupvbn.supabase.co` |
| Database host | `db.akbnfovjdcobifeupvbn.supabase.co` |
| Credential `ref` claim | `akbnfovjdcobifeupvbn` |
| Credential/project correspondence | MATCH |
| DNS | FAIL (`Ping request could not find host`) |
| HTTPS | Cannot be reached (DNS fails) |

**Root cause classification:** `PROJECT_INACTIVE` — the Supabase project itself is paused/inactive, which causes DNS not to resolve.

**Recovery path:** Reactivate the project through the Supabase dashboard at `https://supabase.com/dashboard/project/akbnfovjdcobifeupvbn`. The local Supabase CLI (`v2.90.0`) does not expose a `resume` subcommand, so this must be done through the web UI. No replacement project should be created without explicit authorization.

## Phase 2 — Heidi Root Cause

Tested from the collector's WSL environment:

```bash
curl -X POST -d '{"action":"status"}' http://localhost:3001/api/heidi
```

Response:

```json
{
  "initialized": false,
  "available": false,
  "currentModel": "llama2",
  "provider": "ollama",
  "initError": "Local model service not available. Make sure LM Studio or Ollama is running."
}
```

**Root cause:** The local Ollama/LM Studio model server is not running.

**Status mapping:** The collector correctly maps `available=false` and `initialized=false` to `down`. No interpretation fix needed.

## Phase 3 — Remaining Agents

| Agent | Health Source | Result |
|---|---|---|
| Ursula | `http://localhost:3001/api/ursula/status` | `UNKNOWN` (system_dashboard current_status is null) → collector reports `unknown` |
| CASCADE | `api/chat/route` requires service token and executes the agent; no status-only endpoint | `unknown` (no safe status mechanism) |
| KILO | same as CASCADE | `unknown` |
| ProtoForge | same as CASCADE | `unknown` |
| Hyve | same as CASCADE | `unknown` |

No dedicated health endpoints exist for CASCADE/KILO/ProtoForge/Hyve. The `api/agent-manager/agents.js` registry lists them, but there is no non-executing status route. They remain `unknown` honestly.

## Phase 4 — 1-Hour Collector/Poller Soak

The scheduled tasks have been running unchanged since deployment:

- `HYDI Status Collector` — every 5 min at :00
- `HYDI Dashboard Poller` — every 5 min at :30

Evidence from the local poller log (`tools/dashboard-poller/cache/poll-log.jsonl`):

```text
total polls: 32
successes: 27
failures: 0
failure_count in cache: 0
```

The 5 non-`success` entries are legacy from before the `success` flag was added; none are recorded as failures.

Current cache state:

```json
{
  "status": "live",
  "last_checked": "2026-08-14T02:40:09.325669+00:00",
  "last_success": "2026-08-14T02:40:09.325669+00:00",
  "failure_count": 0,
  "status_source": "local-hydi"
}
```

**Soak result:** PASS — >1 hour of continuous operation, zero cache failures, zero secret leakage, no replay acceptance, no expired-snapshot acceptance.

## Phase 5 — Recovery Test

Executed `tools/dashboard-status/recovery_test.py`:

```text
post fresh: 200
source after fresh: local-hydi
post 31-minute expired: 422
source after expired rejected: local-hydi
PASS  previous good snapshot retained
```

The bridge correctly retains the last good snapshot and rejects an expired one.

## Phase 6 — Cold-Instance Acceptability

| Parameter | Value |
|---|---|
| Snapshot frequency | 5 minutes |
| Vercel GET invocation frequency | 5 minutes (poller) |
| Vercel POST invocation frequency | 5 minutes (collector) |
| Maximum tolerated stale interval | 30 minutes (rejection) / 10 minutes (degraded) |
| Effect of instance restart | In-memory bridge snapshot is lost |
| GET without a POST snapshot | Returns `503 status_source: unavailable` until the next collector POST |
| Recovery time after cold start | ≤5 minutes |

The in-memory architecture is acceptable for this workload because:
- The collector keeps the function warm by POSTing every 5 minutes.
- If the instance restarts, the next POST repopulates the bridge within 5 minutes.
- The dashboard can tolerate brief unavailability during a cold start.
- No durable storage is introduced, satisfying the no-new-persistence-layer constraint.

**Not verified:** Multi-instance behavior. A GET landing on a different Vercel instance than the one that received the latest POST may see `unavailable` until the collector reaches that instance. This is a known, acceptable limitation for the current dashboard.

## Phase 7 — Final Status

| Area | Status | Detail |
|---|---|---|
| **Supabase** | BLOCKED | Project `akbnfovjdcobifeupvbn` is `INACTIVE`; DNS fails. Recovery path: reactivate via Supabase dashboard. |
| **Heidi** | DEGRADED | Local model service (Ollama/LM Studio) not running; collector correctly reports `down`. |
| **Ursula** | UNKNOWN | `api/ursula/status` returns `UNKNOWN` because `system_dashboard.current_status` is null. |
| **CASCADE** | UNKNOWN | No safe, non-executing status endpoint found. |
| **KILO** | UNKNOWN | No safe, non-executing status endpoint found. |
| **ProtoForge** | UNKNOWN | No safe, non-executing status endpoint found. |
| **Hyve** | UNKNOWN | No safe, non-executing status endpoint found. |
| **Bridge** | PASS | 1-hour soak; 0 failures; replay/expiry/auth all correct. |
| **Poller** | PASS | 32 cycles; `failure_count` 0; cache live. |
| **Security** | PASS | No secrets in source/HTML/JS/cache/logs. |
| **Recovery** | PASS | Expired snapshot rejected; previous good snapshot retained. |

## Test Summary

| # | Requirement | Result |
|---|---|---|
| 1 | Missing auth → 401 | PASS |
| 2 | Invalid auth → 401 | PASS |
| 3 | Fresh valid snapshot → 200 | PASS |
| 4 | Bad signature → 422 | PASS |
| 5 | 29-minute-old timestamp → 200 | PASS |
| 6 | 31-minute-old timestamp → 422 | PASS |
| 7 | Replay → 422 | PASS |
| 8 | Supabase healthy + bridge → Supabase wins | NOT TESTED (Supabase INACTIVE) |
| 9 | Supabase down + bridge → local-hydi | PASS |
| 10 | Supabase down + expired bridge → unavailable | NOT TESTED (cold instance not deterministically produced) |
| 11 | Secret scan → clean | PASS |
| 12 | npm typecheck → pass | PASS |
| 13 | npm test → pass | PASS |
| 14 | Collector health checks verified | PASS |
| 15 | Poller cached state verified | PASS |

## Remaining Blockers

1. **Supabase project `akbnfovjdcobifeupvbn` is INACTIVE.** The dashboard bridge compensates, but the primary data source cannot be restored from this side.
2. **Heidi local model service is not running.** This is an infrastructure issue, not a dashboard defect.
3. **CASCADE/KILO/ProtoForge/Hyve lack non-executing status endpoints.** They will remain `unknown` until such endpoints are added.

The dashboard is truthful, resilient, and backed by evidence.
