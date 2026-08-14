# HYDI Phase 6 — Readiness Matrix

| Subsystem | Local persistence | Cloud dependency | Restart recovery | Failure recovery | Authorization | Auditability | Observability | Test evidence | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Heidi control plane | YES — JSON | Optional | YES | YES | YES — RBAC | YES | YES — `GET_APEX_REZONATE_STATUS` | Apex tests 25/25 PASS | GO |
| Apex | YES — JSON | Optional | YES | YES | YES | YES | YES — `GET_APEX_*` | Apex tests 25/25 PASS | GO |
| Rezonate | YES — JSON | Optional | YES | YES | YES | YES | YES — health | Rezonate 128/128 PASS | GO |
| Health / status | YES — `lib/health/local-dashboard-store.js` | Optional — Supabase used only if `HYDI_HEALTH_SOURCE !== 'local'` and env vars set | YES — dashboard file | YES — defaults on missing/corrupt | N/A (read-only endpoint) | YES — writes logged | YES — `/api/health` works without cloud | `tests/unit/health-local-first.test.js` 5/5 PASS | GO |
| Workers | NO | REQUIRED — `workers/QueueManager.js`, `WorkerOrchestrator.js` | NO | NO | N/A | NO | NO | No evidence | NO-GO |
| CASCADE | NO | REQUIRED — `lib/protoforge/raw-ledger.ts`, `protoforge/cascade/src/adapters/ledger-adapter.js` | NO | NO | N/A | NO | NO | No evidence | NO-GO |
| ProtoForge policy | NO | REQUIRED — `lib/protoforge/policy-engine.js` | NO | NO | N/A | NO | NO | No evidence | NO-GO |
| Chat memory | NO | REQUIRED — `lib/heidi-memory.ts`, `lib/session-state.ts`, `lib/work-sessions.ts`, `lib/episodic-memory.ts` | NO | NO | N/A | NO | NO | No evidence | NO-GO |
| Revenue | NO | REQUIRED — `revenue-engine/`, `lib/dashboard/revenue-service.js` | NO | NO | N/A | NO | NO | No evidence | BLOCKED |

## Verdict summary

- **GO:** Heidi, Apex, Rezonate, Health.
- **NO-GO:** Workers, CASCADE, ProtoForge policy, Chat memory.
- **BLOCKED:** Revenue / financial (high risk, external authority).

## Cloud behavior

- `api/health.js` uses Supabase only when `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are present and `HYDI_HEALTH_SOURCE` is not `'local'`.
- If Supabase is absent, the endpoint reads `data/hydi-local/health/dashboard.json`.
- If that file is missing, it returns a default `OK` dashboard and reports `cloud.available: false`.
