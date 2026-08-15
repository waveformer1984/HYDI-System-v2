# HYDI Current Release Blockers

## Status legend

* `OPEN` — unresolved
* `RESOLVED` — fixed
* `MITIGATED` — risk reduced but not removed
* `STALE` — old, no longer current
* `UNKNOWN` — insufficient evidence

## P0 — Prevents safe local operation

| Blocker | Status | Evidence | Severity | Blocks release? | Remediation |
|---|---|---|---|---|---|
| None currently identified | RESOLVED | `npm run typecheck`, `npm run build`, `npm test` all PASS; `npm start` serves pages | N/A | NO | N/A |

## P1 — Prevents confident production deployment

| Blocker | Status | Evidence | Severity | Blocks release? | Remediation |
|---|---|---|---|---|---|
| Packet-level network isolation not re-verified for current build | OPEN | Phase 15 pcap is historical; no current capture | P1 | YES | Re-run `tcpdump`/`netsh` in clean WSL/elevated environment |
| 42 Supabase Edge Functions not runtime-verified | OPEN | `supabase functions serve` not exercised in current session | P1 | YES | Start local Supabase functions and invoke each |
| Full `/api/chat` conversational pipeline not proven end-to-end with real local model | OPEN | `POST /api/chat` returns safe fallback, not a contextual answer | P1 | YES | Run with reachable Ollama or `LOCAL_MODEL_PROVIDER=mock` deterministic provider |
| 24h soak / clean VM / failure injection not executed | OPEN | `docs/audit/OPERATIONAL_QUALIFICATION_REPORT.md` reports WITHHELD | P1 | YES | Execute `operational-qualification` full mode on dedicated host |
| Secret logging in `scripts/rotate-secrets.js` | OPEN | `console.log` of break-glass/service-role tokens | P1 | YES | Remove `console.log` of secrets; write to vault only |

## P2 — Missing capability

| Blocker | Status | Evidence | Severity | Blocks release? | Remediation |
|---|---|---|---|---|---|
| Photo Forge image data transformation | OPEN | Photo Forge uses filename strings, no canvas/file upload | P2 | NO | Implement actual image handling or scope Photo Forge to workspace state |
| Worker queue live probe | OPEN | `LocalHealthProbes.workers()` is placeholder per `HYDI_TRUE_RELEASE_BLOCKERS.md` | P2 | NO | Implement `worker_queues` table depth probe |
| Live dashboard polling | OPEN | `dashboard/heidi-control-plane.html` static | P2 | NO | Add polling/WebSocket to executive API |

## P3 — Cleanup / technical debt

| Blocker | Status | Evidence | Severity | Blocks release? | Remediation |
|---|---|---|---|---|---|
| Mixed unrelated working tree | OPEN | `git status` shows 77 modified/unknown files outside this work | P3 | NO | Isolate or commit/archive separately |
| Hardcoded CORS `*` on non-webhook endpoints | OPEN | `api/checkout.js`, `api/dashboard-status.js`, `api/ursula/status.js` | P3 | NO | Use `process.env.MOBILE_CHAT_ORIGIN` |
| Header-only auth in Ursula frontend | OPEN | `apps/ursula-frontend/src/lib/request-auth.ts` | P3 | NO | Complete JWT Bearer migration |
| `api/traces.js` disabled | OPEN | `api/traces.js.disabled` exists | P3 | NO | Remove or commit decision |

## Summary

No P0 blockers remain. P1 blockers are verification gaps and one secret-logging bug that should be fixed before claiming production readiness. P2/P3 items are non-blocking limitations and debt.
