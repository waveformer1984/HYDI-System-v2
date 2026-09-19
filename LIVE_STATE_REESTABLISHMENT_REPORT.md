# LIVE_STATE_REESTABLISHMENT_REPORT

**Date:** 2026-09-18 → 2026-09-19 (local, -05:00)
**Track:** LIVE RUNTIME (code frozen — `CODE_PROMOTION_READY`, `clean-main@593ece9`, no source modified)
**Scope:** Authorized runtime recovery → ownership proof → health proof → freeze.

---

## A. Before state — why `LIVE_STATE_TRUST = INVALID`

Precheck timestamp ~19:28 local. Evidence: `Win32_Process` ancestry, `Get-NetTCPConnection`, `.pm2` files, `.hydi-boot.lock`, `.recovery-leases/*`, endpoint probes.

| Item | Evidence |
|---|---|
| PM2 daemon | PID 17776 (`lib/Daemon.js`, spawned 14:57:38 by an interrupted `pm2 update`). `pm2 jlist` → `[]` — daemon responsive but **owned zero processes** |
| `dump.pm2` | Claimed 8 apps `online` — **stale**: none had live processes |
| Hung `pm2 update` | PID 27140, spawned 14:46, hung 42 min, parent dead |
| Hung `pm2 restart heidi-web --update-env` | **6 CLIs** (PIDs 31504, 33448, 33168, 23188, 31452, 23752), spawned 14:51–14:54, all parents dead — wedged on the dead daemon's channel |
| Unsupervised orphans | protoforge-core 27392(:3005), heidi-web tree 29100(:3000), mobile-chat 31248(:3006), job-executor-poller chain, python heidi-bridge 24056(:5050) — all with dead ancestors, **zero supervision** |
| Duplicate ollama | PID 12208 `ollama serve`, spawned 12:35 by an unguarded repair test, unbound (port held by 8812) |
| Boot agent | **absent** — `.hydi-boot.lock` claimed dead PID 4832 |
| Recovery leases | heidi-web→dead 4242; protoforge-core→PID 26840 (live wrapper — recovery-spawned orphan) |
| Health | :3005 ok; :3000 `degraded`/`WARNING` with `last_check` 4.5h stale (health scheduler dead); :3006 ok, heidiCore:false |
| heidi-core :3459 / advisory :3461 | no listeners |

## B. Process boundary

| PID | Classification | Disposition |
|---|---|---|
| 17776 | `CANONICAL_PM2_OWNED` (daemon) | kept — responsive |
| 27140, 31504, 33448, 33168, 23188, 31452, 23752 | `KNOWN_INCIDENT_ARTIFACT` (7 hung PM2 CLIs) | **terminated** (exact PIDs) |
| 12208 | `KNOWN_INCIDENT_ARTIFACT` (dup ollama, unbound, test-spawned) | **terminated** |
| 27392/26840, 29100/9804/20752/14396/30064, 31248, 10672/14044/30128/1644 | `AUTHORIZED_ORPHAN` (HYDI services, dead ancestors) | **terminated** (12 PIDs) to allow canonical respawn |
| 24056 `python heidi-bridge.py` :5050 | `AUTHORIZED_ORPHAN` — non-canonical companion, non-conflicting | **left running**, documented |
| 8812 `ollama serve` :11434 | `AUTHORIZED_ORPHAN` — local-model infra, bound & serving | kept |
| Docker Desktop + 11 supabase containers | `UNRELATED_PROCESS` (infra) | untouched |
| devin.exe + MCP servers | `UNRELATED_PROCESS` (agent session) | untouched |

All terminations used exact PIDs after classification; no `taskkill /IM` sweeps. Termination log retained in session evidence.

## C. Supervisor

- **One** PM2 daemon: PID 17776, `\\.\pipe\rpc.sock`, `pm2.pid`=17776.
- Canonical chain restored: `PM2(17776) → hydi-boot(ProcessContainerFork pid 29484, bootId e57834af862498ead56707c6, scripts/boot-agent.js) → boot.config.json children`.
- `.hydi-boot.lock` = `{pid:29484, ppid:17776}` — **lease ↔ PM2 record ↔ live process all agree**.
- `pm2 jlist`: 7 apps online — hydi-boot, hydi-watchdog, hydi-daemon, hydi-system-health, hydi-stuck-job-scheduler, hydi-revenue-reconciliation, hydi-failed-webhook-retry. `hydi-protoforge-scout` deliberately **not** started (ProtoForge mission runner — outside this phase's authority).
- `pm2 save` written — dump now matches reality.

## D. Service ownership

| Service | PID | Parent | Owner | Lease | Port | Health |
|---|---|---|---|---|---|---|
| hydi-boot | 29484 | 17776 (PM2) | CANONICAL_PM2_OWNED | `.hydi-boot.lock` live | — | online |
| protoforge-core | 15716 | cmd 12252 ← 29484 | CANONICAL_CHILD | `.recovery-leases` →15716 (reconciled) | 3005 | HEALTHY (`/health` modules_state=HEALTHY) |
| heidi-web | 34012 | next 9344 ← npm 20568 ← 29484 | CANONICAL_CHILD | `.recovery-leases` →20568 (reconciled) | 3000 | HEALTHY (`status:healthy`, fresh runs) |
| heidi-mobile-chat | 12552 | cmd 36284 ← 29484 | CANONICAL_CHILD | — | 3006 | ok (heidiCore:false) |
| job-executor-poller | 33852 | tsx 16668 ← npx 32504 ← cmd 10364 ← 29484 | CANONICAL_CHILD | — | — | alive (liveness ok) |
| hydi-watchdog | 33716 | 17776 | CANONICAL_PM2_OWNED | — | — | cycling 30s, clean |
| hydi-daemon | 584 | 17776 | CANONICAL_PM2_OWNED | — | — | cycles running, escalating correctly |
| 4 schedulers | 28576,20328,34640,22768 | 17776 | CANONICAL_PM2_OWNED | — | — | online |
| ollama | 8812 | (orphan, infra) | AUTHORIZED_ORPHAN | — | 11434 | 7 models serving |
| heidi-bridge | 24056 | (orphan) | AUTHORIZED_ORPHAN (non-canonical) | — | 5050 | listening |

## E. Lease state

| Lease | Content | Status |
|---|---|---|
| `.hydi-boot.lock` | bootId e57834af…, pid 29484, ppid 17776 | **live, consistent** |
| `.recovery-leases/protoforge-core.json` | was stale (dead 26840) → reconciled to pid 15716 | **live** |
| `.recovery-leases/heidi-web.json` | was stale (dead 4242) → reconciled to pid 20568 (boot-spawned `npm run dev` wrapper) | **live** |
| `.hydi-boot-control/` | empty — no pending requests/acks | clean |

## F. Health — observed truth

- `:3005/health` → `status:ok, modules_state:HEALTHY, 13 modules, heidi_events>0` → **HEALTHY**.
- `:3000/api/health` → was `degraded`/`WARNING` on stale `last_check` (200 ≠ healthy — verified). After `hydi-system-health` produced fresh `system_health_runs` rows → `status:healthy, hydi_status:OK` → **HEALTHY** (escalation_level WARNING latch decays separately).
- `:3006/api/health` → `server:ok, ollama:true, heidiCore:false` → **HEALTHY** (heidi-core not in canonical inventory).
- supabase_db/rest → 200 via watchdog checks; ollama → HEALTHY.
- **Observer-vs-target verified live:** watchdog logged `FAIL ... state=DEGRADED status=200` for heidi-web, then `OBSERVE ... classified as HEALTHY (HIGH) — recovery NOT authorized` — the observer (stale health data) was at fault, not the target; `falseRecoveriesPrevented` incremented. No health runs were manufactured.

## G. Watchdog

- Single process 33716, PM2-owned, 30s interval; ≥90s observed directly (plus full log history).
- Cycles: clean OK ticks; failure → `FAILURE_SUSPECTED` → `FAILURE_CONFIRMED` hysteresis → single DELEGATE → `RECOVERING` suppression of duplicates.
- No flapping, no duplicate supervisors, observer/target split honored, `falseRecoveriesPrevented=11`, evidence + METRICS logged every cycle.
- Does not restart healthy services (proved: refused heidi-web restart during degraded-data window; mobile-chat optional → log-only).

## H. Controlled failure / recovery

1. **heidi-mobile-chat kill (PID 27636, 19:37:55):** detected 19:38:20 `ECONNREFUSED` → `optional — logging only, not calling RecoveryEngine` — correct policy (not required). Restored on next canonical boot.
2. **protoforge-core down (19:40:28):** failure detected 19:40:54 SUSPECTED → 19:41:22 CONFIRMED → DELEGATE → RecoveryEngine → **signed boot-control request** → boot-agent respawn → new node 32448 (cmd 12748 ← boot 35136) → port re-bound → 19:42:23 back in OK list. Full detect→authorize→respawn→verify chain proven live.
3. **Fail-closed negatives:**
   - Forged request (bad signature) + unsigned request planted in `.hydi-boot-control` → **never acked, never actioned**, services untouched.
   - Recovery on unverifiable process identity (heidi-web PID 18120, port-owner ≠ configured `npm run dev`) → `process-identity: wrong process` → `ESCALATION_REQUIRED` — refused rather than killing an unproven process.
   - Operator signed request for not-owned module → signed ack `status:failed, "not owned by this boot agent"` — channel verified end-to-end, ownership gate held.
   - Recovery retry budget: `POLICY STOPPED — retry budget exhausted for protoforge-core: 4/3` — circuit breaker works.
4. **No fabricated acks:** all acks observed are signed and verify.

## I. Second restart

`pm2 restart hydi-boot` performed (multiple cycles observed):
- Graceful shutdown via `shutdown_with_message` (children stopped, PM2 IPC) — verified.
- Re-boot: preflight (canonical gate, Stripe guardrail, ports, Docker, Supabase CLI) → dependency-ordered spawn → health gates → `Boot complete` — verified at 19:46:24, 19:50:25, 19:55:04, 20:05:30, 20:08:23.
- Every cycle converged to: 1 daemon, 1 boot-agent (lease-enforced), 4 owned children, correct ports, green health.
- **PM2 double-fork race (systematic, 3/3 restarts):** outgoing fork's late exit → PM2 spawns a second fork → lease arbitration stands the loser down (exit 75) → PM2 record then points at the dead fork (`waiting restart pid:0`) while the live PM2-spawned fork runs. The lease guarantees exactly-one-supervisor; bookkeeping required `pm2 delete hydi-boot` + `pm2 start --only hydi-boot` (no outgoing tracked fork → single fork → tracked correctly). Final state consistent.

## J. Local-first proof

- **Local DB:** 11 `supabase_*_HYDI-System-v2` containers up 5 days (db, kong, auth, rest, realtime, storage, studio, pg_meta, inbucket, analytics, vector); `SUPABASE_URL=http://127.0.0.1:54321`; watchdog `supabase_db:200, supabase_rest:200`.
- **Local model:** `ollama serve` :11434, 7 models (qwen2.5:7b, llama3.2:3b, llama3, llama3.2, tinyllama, qwen2.5-coder:1.5b, nomic-embed-text).
- **Local FS state:** `.hydi/`, `.recovery-leases/`, `.hydi-boot.lock`, `data/`, `logs/` all local.
- **Embeddings:** `EMBEDDING_PROVIDER` unset → local-first Ollama default (ambient `OPENAI_API_KEY` no longer routes memory to cloud — R2 fix verified in code track).
- **Stripe unset** → revenue correctly optional (`OPTIONAL_SERVICE_UNAVAILABLE`, not a health fault).
- **No GitHub/hosted CI/paid cloud required for core:** full boot + health + recovery ran with zero external calls.

## K. Remaining anomalies (disclosed, not hidden)

1. **Phantom restart requester (unresolved):** signed `restart requested by RecoveryEngine` for protoforge-core at 19:37:42, 19:40:24, 19:41:49, 19:44:17 (~2.5min cadence) while healthy — only one was the PM2 watchdog's. Cadence matches Task-Scheduler-spawned `watchdog.js --once` transients (svchost parent). Likely driven by the stale `.recovery-leases` pid claim (now reconciled); silent for ~30min across 4 boots. Burned the retry budget (4/3) → real recovery temporarily escalated — circuit breaker correctly bounded it.
2. **PM2 `restart hydi-boot` double-fork race** — systematic on Windows; lease arbitration contains it to one supervisor but PM2 record loses the child. Workaround used: `pm2 delete` + `pm2 start --only`. Recommend a code-track fix (spawn suppression during restart or PM2 `stop_exit_codes`/`restart_delay` tuning).
3. **`HealthProvenanceChecker` identity check can't pass for heidi-web** — port owner is the grandchild `next start-server`, configured command is `npm run dev` → deterministic `wrong process` → heidi-web recovery always escalates instead of recovering. Fail-closed (safe) but means heidi-web can't self-heal; code-track finding.
4. **Boot-control respawn doesn't update `.recovery-leases`** — respawns via boot-control leave stale lease pids (reconciled manually here); code-track candidate.
5. **`pm2 delete`+`start` needed for bookkeeping** — dump now truthful after `pm2 save`.
6. **`.pm2/pids/`** holds stale pid files from historical apps (blamegames, ursula-*) — cosmetic.
7. **heidi-bridge.py :5050** — non-canonical orphan left running deliberately (companion service, no port/config conflict).
8. **heidi-core :3459 / advisory :3461** down — not in canonical inventory; mobile-chat health reports `heidiCore:false` consistently.
9. **Preflight environment sensitivity:** first boot aborted (Docker daemon >90s to respond; `npx supabase --version` timeout under load) — passed on retry; transient, not code.
10. **`hydi-protoforge-scout`** intentionally not started (mission scheduler outside this phase's authority).

## Final verdict

**`LIVE_STATE_REESTABLISHED`**

- One PM2 daemon (17776), one hydi-boot (29484) — PM2 record ↔ lease ↔ live process agree.
- All canonical children owned, leased, correct ports, real (non-manufactured) health.
- Watchdog proven: hysteresis, observer/target distinction, no flap, bounded recovery.
- Controlled failure → signed recovery → canonical respawn → health return — proven live.
- Fail-closed verified: forged/unsigned control requests, wrong-process identity, ownership gate, retry circuit breaker.
- Second+ restarts converge cleanly; local-first runtime requires no cloud/GitHub/CI.
- Anomalies above are documented for the code track; none leave the live boundary ambiguous.

**Not declared:** `OPERATIONAL`. No ProtoForge autonomous missions run; self-development not enabled; no revenue-readiness or autonomous-qualification claim.
