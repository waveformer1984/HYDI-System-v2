# Weekly resource discovery scheduler (disabled by default)

## What it is

Child job **`hydi-resource-discovery`** inside existing `hydi-schedulers` PM2 process. It runs `scripts/resource-discovery-scheduler.js --once`. **No new always-on agent.**

## Activation (separate owner approval)

All required:

- `HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY=1`
- Optional: `HYDI_ALLOW_AUTOMATED_VERIFICATION=1` (HTTP probe pass)
- Optional: `HYDI_ALLOW_LIVE_DISCOVERY=1` (legacy reachability helper in cycle)

**Frank:** do not set these without explicit operator sign-off.

## Bounds

| Control | Value |
|---------|--------|
| Default interval | 7 days (`HYDI_RESOURCE_DISCOVERY_INTERVAL_MS`) |
| Supervisor kill | 300s (`HYDI_RESOURCE_DISCOVERY_TIMEOUT_MS`) |
| Overlap | `MissionRunLock` at `.runtime/resource-discovery.lock` |
| HTTP probes per run | `HYDI_VERIFY_LIMIT` default **12** |
| Sequential fetches | No parallel burst inside `runVerificationPass` |
| Per-fetch timeout | 8s; body cap 120KB; HTTPS only (probe) |
| Redirects | Max 5 hops, each hop re-validated |
| Model/API cost | **$0** (no LLM) |
| Retry | None — next run after interval from completion |
| Logs | Append `logs/resource-discovery-scheduler.log` |
| State | `.runtime/resource-discovery/last-cycle.json` |
| Evidence | `.runtime/resource-discovery/evidence/*.json` |
| Retention | **Operator-defined** — no automatic purge |

## What it does not do

- Does not enable prepare/submit/award
- Does not verify benefit terms (`published_benefits_verified` remains operator-only)
- Does not replace on-demand `node scripts/resource-discovery-cycle.js weekly`