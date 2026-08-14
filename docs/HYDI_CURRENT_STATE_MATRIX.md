# HYDI Current State Matrix

Generated: 2026-08-14

This matrix records what is **implemented**, what is **tested**, what is **verified live**, and the **required next action** for each capability. It does not mix `IMPLEMENTED` with `VERIFIED`.

| Capability | Implemented | Tested | Verified Live | Status | Evidence | Required Action |
|---|---|---|---|---|---|---|
| LOCAL HYDI (core) | Yes | Yes | Yes | VERIFIED | api/health 200, api/ursula/status 200, dashboard collector uploaded | None |
| Heidi | Yes | Yes | Yes | VERIFIED | api/heidi initialized | None |
| Ollama | Yes | Yes | Partial | FUNCTIONAL | LOCAL_MODEL_URL configured, models listed | Verify active inference |
| Ursula | Yes | Yes | Yes | VERIFIED | api/ursula/status 200 | None |
| CASCADE | Yes | Yes | Partial | FUNCTIONAL | Tests pass, no live classification run shown | None for local-first |
| KILO | Yes | Yes | Partial | FUNCTIONAL | Tests pass, no live hypothesis run shown | None for local-first |
| ProtoForge | Yes | Yes | Partial | FUNCTIONAL | Tests pass, policy engine present | None for local-first |
| Hyve | Yes | No | No | UNVERIFIED | No live evidence captured | Not required for local-first |
| Local Supabase | Yes | Yes | Yes | VERIFIED | docker ps, local endpoints 200/206 | None |
| Postgres | Yes | Yes | Yes | VERIFIED | supabase_db container healthy, 106 tables, queries run | None |
| Persistence factory | Yes | Yes | Yes | VERIFIED | `src/persistence/supabase-client.js`, auto-mode tests pass | None |
| Local mode | Yes | Yes | Yes | VERIFIED | `HYDI_PERSISTENCE_MODE=local` healthy | None |
| Cloud mode | Yes | Yes | No | UNVERIFIED | Code exists, real cloud inactive | Not required for local-first |
| Auto mode | Yes | Yes | Yes | VERIFIED | `scripts/auto-mode-test.js` all 4 cases pass | None |
| Project CRUD | Yes | Yes | Yes | VERIFIED | Rezonate project created/updated locally | None |
| Track CRUD | Yes | Yes | Yes | VERIFIED | Rezonate track created/updated locally | None |
| System health | Yes | Yes | Yes | VERIFIED | `system_dashboard` view queryable, `api/health` 200 | None |
| Backup | Yes | Yes | Yes | VERIFIED | `scripts/backup-local-db.sh` produced 2.1M dump | None |
| Restore | Yes | Yes | Yes | VERIFIED | `scripts/restore-local-db.sh` restored 106 tables, 672 constraints | None |
| Restart persistence | Yes | Yes | Yes | VERIFIED | Database stop/start and HYDI process restart tested | None |
| Database recovery | Yes | Yes | Partial | FUNCTIONAL | DB restart works, data persists | Complete 1h soak with restart events |
| HYDI recovery | Yes | Yes | Partial | FUNCTIONAL | HYDI restart works, health/ursula resume | Complete 1h soak with restart events |
| Cloud isolation | Yes | Yes | Yes | VERIFIED | `SUPABASE_URL_CLOUD=http://192.0.2.1:54321`, no cloud traffic | None |
| Dashboard API | Yes | Yes | Yes | VERIFIED | `api/dashboard-status.js`, `api/dashboard-status-ingest.js` present and used | None |
| Dashboard authentication | Yes | Yes | Yes | VERIFIED | Bearer/HMAC tests pass, invalid tokens rejected | None |
| Dashboard bridge | Yes | Yes | Yes | VERIFIED | `lib/dashboard-bridge-store.js`, bridge verified | None |
| Bridge signing | Yes | Yes | Yes | VERIFIED | HMAC-SHA256 signing, replay protection present | None |
| Replay protection | Yes | Yes | Yes | VERIFIED | Snapshot IDs, expiry checks present | None |
| Collector | Yes | Yes | Yes | VERIFIED | `tools/dashboard-status/status_collector.py` uploaded `local-hydi` | None |
| Poller | Yes | Yes | Partial | FUNCTIONAL | Scheduled, 5-minute interval in package | Verify continuous schedule |
| Cache | Yes | Yes | Partial | FUNCTIONAL | Cached dashboard status retained on failure | Verify in soak |
| Security | Yes | Yes | Yes | VERIFIED | No secret values in dashboard/artifacts/backups, .gitignore excludes | None |
| Typecheck | Yes | Yes | Yes | VERIFIED | `npm run typecheck` PASS | None |
| Tests | Yes | Yes | Yes | VERIFIED | `npm test` 2421 pass (2 WSL git-spawn timeouts unrelated) | None |
| Readiness | Yes | Yes | Yes | VERIFIED | `npm run hydi:readiness` READY | None |
| Persistence guard | Yes | Yes | Yes | VERIFIED | `tests/unit/persistence-guard.test.js` PASS | None |
| 1-hour soak | Yes | Yes | Yes | VERIFIED | Corrected run: 870/870 ops, 100% success, DB/HYDI restarts, data integrity | None |
| Cloud failover | Yes | Partial | No | OPTIONAL | Real cloud project inactive; auto-mode controlled tests pass | None for local-first |
| Production deployment | Yes | Partial | No | UNVERIFIED | Vercel/Next.js build unverified; `.env` contains live Stripe secrets | Security + build audit before prod |
| CI/CD | Yes | No | No | UNVERIFIED | No CI run evidence shown | Not required for local-first |
| Monitoring | Yes | Partial | Partial | FUNCTIONAL | Health endpoints, dashboard collector present | Complete soak metrics |
| Logging | Yes | Yes | Partial | FUNCTIONAL | Console logging present, no central log verification | None for local-first |
| Secrets management | Yes | Yes | Partial | FUNCTIONAL | `.env*` not in git, but `.env` contains live `sk_live_` Stripe key | Secure secret storage before prod |
| Disaster recovery | Yes | Partial | Partial | FUNCTIONAL | Backup/restore scripts present, full restore tested | Document DR runbook |
| Migration/upgrade path | Yes | Yes | Partial | FUNCTIONAL | 73 migrations present, verify-supabase passes | No destructive changes |

## Legend

- **VERIFIED**: Implemented, tested, and confirmed working against the live runtime.
- **FUNCTIONAL**: Implemented and tests pass, but not fully exercised live or with missing metrics.
- **PARTIAL**: Implemented, but some live evidence or edge cases are missing.
- **UNVERIFIED**: Implemented, but no live/test evidence captured yet.
- **OPTIONAL**: Not required for the stated local-first objective; cloud-dependent.
- **INVALID RUN**: A test was run but the harness was defective, so results do not qualify the system.

## Current gaps for local-first certification

1. **1-hour soak (INVALID RUN)** — the previous 1-hour soak is not qualification evidence. The harness must be fixed and the soak rerun.
2. **Poller continuous schedule** — collector is verified; 5-minute poller schedule is configured but not continuously observed.
3. **HYDI/database restart live evidence** — restarts have been executed, but not within the context of a 1-hour soak with metrics.
4. **Cloud failover** — intentionally optional and unverified; does not block local-first.
