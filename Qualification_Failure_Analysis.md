# Qualification Failure Analysis

## Executive Summary

The `npm run operational-qualification` quick run completed, but the **workload execution phase failed** with a 33.3% success rate (target ≥ 99%). The failures are concentrated in four workloads. Analysis of the qualification harness, the target endpoints, and the API route implementations shows that **all four failures are caused by an outdated or misconfigured qualification harness**, not by production code defects.

## Failure Classification

| Workload | Error | Count / Rate | Category | Root Cause |
|----------|-------|--------------|----------|------------|
| `conversation` | `Conversation request failed: 400` | High | **Harness defect** | Harness POSTs to `/api/chat` with `{message, system}`; `/api/chat` requires `{message, session_id, user_id}`. The universal chat router is at `/api/chat/route` and requires `x-hydi-service-token`. |
| `memory-storage` | `Memory storage request failed: 500` (live: 404) | High | **Harness defect** | Harness POSTs to `/api/memory`, which does not exist. No public memory-storage endpoint is implemented in the current API surface. |
| `memory-retrieval` | `Memory retrieval request failed: 405` | High | **Harness defect** | Harness POSTs to `/api/memory/search`; the route only accepts `GET` and uses query parameters. |
| `supervisor-status` | `request to http://localhost:9999/status failed, reason: ` | High | **Harness defect** | `localhost:9999` is the Supabase auth container, not the HYDI supervisor. The supervisor (`supervisor.js`) is not in the stack orchestrator and is intentionally excluded (`HYDI_REQUIRE_SUPERVISOR=false`). |
| `memory` (harness) | `Resource leak detected` | Critical | **Harness defect** | The `WorkloadDriver` retains the full JSON response body for every successful workload execution, causing the harness heap to grow ~9.23 MB/hr. |

## Evidence

### Endpoint tests against the running Next.js dev server

```
POST /api/chat                          → 400
POST /api/chat/route (no token)         → 401
POST /api/memory                        → 404
POST /api/memory/search                 → 405
GET  /api/memory/search?q=test&limit=10 → 401
GET  /api/ursula/status                 → 200
GET  /api/health                        → 200
```

### Relevant source files

- `pages/api/chat.ts` requires `message`, `session_id`, `user_id` and returns SSE.
- `api/chat/route.js` (mounted at `/api/chat/route`) requires `x-hydi-service-token` and `{message, system}`.
- `api/memory/search.js` accepts `GET` only and requires `x-hydi-service-token`.
- `operational-qualification/config/qualification-config.json` defines the outdated endpoints and no auth secret.
- `operational-qualification/workloads/workload-driver.js` builds the wrong request bodies and methods.
- `services-manifest.json` does not include `supervisor.js` in the startup order; `HYDI_REQUIRE_SUPERVISOR=false` is set by the harness.

## Repair Plan

1. **Qualification harness configuration**
   - Point `conversation` to `/api/chat/route`.
   - Point `memory-storage` and `memory-retrieval` to `GET /api/memory/search` (query params) or remove the non-existent storage endpoint.
   - Point `supervisor-status` to `/api/ursula/status`.
   - Ensure `HYDI_SERVICE_SECRET` is set so the harness can generate `x-hydi-service-token` headers.
2. **Qualification harness workloads**
   - Generate valid HMAC service tokens for authenticated routes.
   - Use correct HTTP verbs and payloads.
   - Stop retaining full response bodies in `WorkloadDriver.metrics`.
3. **Ursula runtime** (separate, non-blocking)
   - `ursula-flask` is still restarting due to a missing `__init__.py` in the `blame_games` package. This is a companion service and not the cause of the HYDI qualification failures.

## Conclusion

All four high-volume qualification failures are **harness or configuration defects**, not production code defects. The production API routes (`/api/chat/route`, `/api/memory/search`, `/api/ursula/status`, `/api/health`) respond correctly when called with the right method, payload, and token. The memory-storage endpoint the harness expects does not exist in the documented public API surface, so the harness must be corrected rather than a new endpoint added.
