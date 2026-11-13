# PHASE 0 — Ground-Truth Audit of Frank
Verified live 2026-11-12 ~19:50–20:10 CT. Host: DESKTOP-I719OIN ("Frank"), user Owner.
Nothing below is taken from docs; every claim has a live check behind it.

## 0. HEADLINE FINDING — Frank is in a resource crisis right now

- **119 hung `pm2 update` node.exe processes** accumulated since ~11:08 (parents all gone;
  no caller found in repo, ProtoForge_Ecosystem, hydi-ctl-plane, or .hydi scripts).
  Count is stable (not currently growing) but they never exit — each holds ~30–50 MB.
- **RAM: ~1.2 GB free.** 152 node.exe processes total.
- This is the proximate cause of the current service instability: restart storms,
  EADDRINUSE crash-loops, Ollama timeouts, slow local-ci. It likely explains most of
  the "Heidi wedges itself" symptoms seen over the past days.
- **ACTION NEEDED (not taken — audit only):** killing the 119 `pm2 update` processes is
  safe (they're orphaned CLI invocations, not PM2-managed apps) and would immediately
  free several GB. Recommend Jordan approve `Get-Process node | ? {$_.CommandLine -match 'pm2 update'} | Stop-Process` — verify command line first.

## 1. Process / port inventory (live)

Port checks via TCP connect (netstat/Get-NetTCPConnection are unreliable in this
environment — see §6):

| Port | State | What answers |
|---|---|---|
| 3000 | OPEN | heidi-web-standalone — **but see split-brain below** |
| 3001 | OPEN | (protoforge/other) |
| 3005 | OPEN | protoforge-core |
| 3006 | CLOSED | heidi-mobile-chat down (PM2 waiting restart) |
| 3100 | OPEN | ursula-frontend next start (pid 6140/49764 — TWO next processes seen) |
| 3456 | CLOSED | nothing (heidi-core's internal default port — unused) |
| 3459 | OPEN | heidi-core — **orphan, PM2 crash-looping EADDRINUSE** |
| 3999 | CLOSED | nothing |
| 5000 | OPEN | ursula-flask (docker, healthy) |
| 5050 | CLOSED | Heidi Bridge NOT running |
| 8080 | CLOSED | nothing |
| 8765/8766/8767 | CLOSED | nothing (ports from old docs — dead) |
| 11434 | OPEN | Ollama answering |
| 54321/54322 | OPEN | local Supabase kong/db (docker, healthy) |
| 4000 | OPEN | ursula-hub/ProtoHub (docker, healthy) |

### PM2 fleet (pm2 jlist, live)
27 apps. **Online:** hydi-boot, hydi-watchdog, hydi-daemon, hydi-system-health,
hydi-protoforge-scout, hydi-stuck-job-scheduler, hydi-revenue-reconciliation,
hydi-failed-webhook-retry, hydi-billing-worker, hydi-model-prep-executor,
hydi-revenue-autopilot-tick, hydi-stripe-webhook-listener, hydi-public-tunnel,
hydi-daily-loop, heidi-agent, frank-auto-deploy, frank-storage-guard, rezonate-app,
hydi-local-ci, frank-observer, hydi-schedulers, pm2-logrotate.
**Waiting restart (crash-looping):**
- `heidi-core` — 167 restarts, EADDRINUSE :3459 (orphan holds port)
- `heidi-web-standalone` — 42 restarts
- `ursula-local` — 609 restarts
- `ollama-serve` — 630 restarts (but :11434 answers — Ollama itself runs outside PM2 wrapper)
- `heidi-mobile-chat` — 0 restarts, never came up (needs HEIDI_MOBILE_TOKEN)

### SPLIT-BRAIN confirmed live (again)
- :3459 answers `/health` (uptime ~51 min, reports gitSha 22de858d = current HEAD)
  but PM2's heidi-core is in EADDRINUSE crash-loop. Provenance file says pid **6548**
  started 02:02Z — a live process PM2 doesn't own. Same pattern as the 2026-11-11
  heidi-web orphan incident.
- :3000 answers; provenance says pid **29948** `next start`, serving build stamp
  **bc82c99a** — a pre-merge build. PM2 heidi-web-standalone is waiting restart.
  The phone UI is up but may be serving stale code until frank-auto-deploy rebuilds.

### start-heidi-everything.ps1 — does NOT run
Two versions exist:
- `C:\ProtoForge_Ecosystem\start-heidi-everything.ps1` — the 4-component version
  (Ursula Suite docker, Heidi Bridge :5050, Heidi Mobile :3006, Forge Loop).
  Manually-run only; spawns visible powershell windows; NOT idempotent-safe
  (kills whatever holds :3006).
- `C:\Users\Owner\hydi-ctl-plane\start-heidi-everything.ps1` — repo-scoped variant
  (Ollama, heidi-core :3459, mobile :3006, bridge :5050, Next dev :3000, Supabase).
  Its own header says Forge Loop/Ursula Suite were dropped.
- Startup folder has `Heidi AutoStart.lnk.disabled` — **disabled**.
- All HYDI/HEIDI scheduled tasks are Disabled except `\PM2Resurrect` (Enabled,
  logon) → runs `C:\Users\Owner\.hydi\hydi-boot-resurrect-launcher.ps1`, which
  falls back to bare `pm2 resurrect` because `scripts/hydi-boot-resurrect.ps1`
  **does not exist in the repo**.

Component status vs the 4-part script:
| Component | Up? | Health |
|---|---|---|
| Ursula Suite (docker :5000/:4000/:5432/:6379) | YES — up ~3h, all healthy | docker compose restart policy, NOT the script |
| Heidi Bridge :5050 | NO | dead |
| Heidi Mobile :3006 | NO | PM2 waiting restart |
| Forge Loop | NO evidence of running | forge-loop.ps1 not observed |

## 2. heidi-core/server.js clean start — NOT confirmed
It is crash-looping on EADDRINUSE, so a clean PM2 start is currently impossible
without first removing the :3459 orphan (pid 6548). The code itself starts fine —
the orphan is running current HEAD and answering — but PM2 ownership is broken.
`heidi-system-status.test.js` passes 9/9 on clean-main (canonical suite).

## 3. Supabase (local, project containers supabase_*_HYDI-System-v2, kong :54321)
~155 public tables. Named tables:

| Table | Rows | RLS |
|---|---|---|
| heidi_state_snapshots | **DOES NOT EXIST** | — |
| heidi_events | 281,101 | on |
| heidi_reflections | 0 | on |
| heidi_reflection_snapshots | 2,611 | (exists — Phase 1 may reuse or supersede) |
| heidi_decision_bounds | 1 | on |
| agent_bus | 0 | on |
| heidi_missions | 11,524 | — |

`heidi_decision_bounds` row: threshold 0.85, resolver 'frank',
`unattended_enabled = false`, empty deny-lists — i.e. unattended execution is
off at the DB level too (consistent with HEIDI_ALLOW_EXEC=false).

## 4. Local models (Ollama :11434 — answers)
Installed: qwen2.5:3b (1.9GB), qwen2.5:7b (4.7GB), llama3.2:3b, llama3:latest,
llama3.2:latest, tinyllama (637MB), qwen2.5-coder:1.5b, nomic-embed-text.
**`qwen2.5:3b-instruct-q4_K_M` is NOT installed** — Phase 1/2 must use `qwen2.5:3b`
(or pull the named variant; pulling is a ~2GB download, still $0).
A generate probe timed out under current RAM pressure — model files exist but
inference is starved until the pm2-update pile is cleared.

## 5. Doc-vs-reality discrepancies
- Port lists in old docs (3456, 8765–8767, 8080, 3999) — nothing listens on any of them.
- "heidi-core on :3465" appeared in an old report — actual is :3459.
- start-heidi-everything does not auto-run; Ursula Suite is up via Docker restart
  policy, not the script. The script's health targets (:5050 bridge, :3006 mobile,
  :5000/:4000 Ursula) are only half-alive.
- `scripts/hydi-boot-resurrect.ps1` referenced by the PM2Resurrect launcher is
  missing from clean-main → silent fallback to bare `pm2 resurrect`.
- `.next/standalone` contains a stale copy of `tests/` — fixed via #548
  (testPathIgnorePatterns), merged; needs a fresh standalone build to fully clear.
- heidi-web provenance reports gitSha bc82c99a (build stamp, pre-#538..547 merges)
  — the live :3000 build predates this week's merges; frank-auto-deploy must rebuild.

## 6. Environment caveat for future agents
`netstat -ano` and `Get-NetTCPConnection` do not show real LISTENING sockets in
this shell (all LISTENING rows show pid 0 / foreign 127.0.0.1:0). TCP connect
checks (/dev/tcp, curl) and `pm2 jlist` + provenance files are the reliable
liveness evidence here. Consequence: watchdog-split-brain's `listenerPids()`
returns empty on this host → the SPLIT-BRAIN check currently cannot fire.
Recommend a follow-up: treat "endpoint ok + PM2 app not online" as split-brain
evidence without needing the listener PID (pid becomes best-effort enrichment).

## 7. What exists / what runs / what is dead — summary
- RUNNING & healthy: PM2 fleet (minus 5), local Supabase, Ollama, Ursula docker
  stack, rezonate-app, heidi-agent.
- RUNNING but orphaned: heidi-core :3459 (pid 6548), heidi-web :3000 (pid 29948,
  stale build).
- DEAD: heidi-mobile-chat :3006, Heidi Bridge :5050, Forge Loop, ursula-local PM2,
  ollama-serve PM2 wrapper.
- MISSING: heidi_state_snapshots table; hydi-boot-resurrect.ps1; the
  qwen2.5:3b-instruct-q4_K_M model.
- ON FIRE: 119 hung `pm2 update` processes, ~1.2 GB free RAM.

STOP — awaiting Jordan's review before Phase 1.
