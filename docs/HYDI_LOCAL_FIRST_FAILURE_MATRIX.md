# HYDI Local-First Failure Matrix

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| Cloud down / local up | HYDI operates locally; no cloud calls | `api/health` healthy, `api/ursula/status` success, project/track CRUD works, bridge reports `local-hydi` | PASS |
| Cloud unreachable (fake cloud config) | Local still operates | `api/health` healthy, `api/ursula/status` success, collector `supabase: healthy` | PASS |
| Local Supabase stopped | Persistence operations fail honestly | `api/health` returns `unavailable`; no fabricated success | PASS |
| Local Supabase restarted | HYDI recovers; existing data intact | `api/health` returns `healthy`; project `d473f4c1-...` and track `4a00aa29-...` still exist | PASS |
| HYDI restart (Next.js dev) | `api/health` healthy after startup | Verified after process kill/start | PASS |
| Docker restart (db container) | Existing data persists; service recovers | `supabase_db` container stopped/started; data intact | PASS |
| Backup | Timestamped, verified dump created | `backups/local/20260814-041004/` created and TOC-verified | PASS |
| Restore | Disposable DB restores schema + representative data | 106 tables, 1 `system_health_runs`, 672 constraints; non-fatal `pg_cron` warnings only | PASS |
| Auto mode (local available) | Uses local | Unit test `persistence-guard` confirms source=`local` | PASS |
| Auto mode (local unavailable, cloud available) | Falls back to cloud with recorded reason | Implemented in factory; not live-tested against real cloud | NOT TESTED |
| Auto mode (both unavailable) | Honest failure | Not live-tested | NOT TESTED |
| Bridge failure | Dashboard shows last known good; collector honest | Not specifically tested | NOT TESTED |
| Collector failure | No fake status | Collector uses actual endpoint responses; not tested by forced failure | NOT TESTED |

## Notes

- The `pg_cron` warnings during restore are expected because the disposable test database is not the `postgres` database that `pg_cron` is configured for.
- Auto-mode cloud fallback was not tested against a real cloud Supabase because the canonical cloud project remains `INACTIVE`.
- The 1-hour local endurance soak (Gate 14) was not executed in this session.
