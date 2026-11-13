# PHASE 0.5 — Stabilize Frank
Executed 2026-11-12 ~20:25–21:00 CT on Frank. HEIDI_ALLOW_EXEC stayed `false` throughout.

## 1. pm2-update spawner — found and stopped

**Spawner:** PM2 God daemon's domain-error handler. Per `docs/operations/PM2_OBSERVABILITY_AGENT_H.md`,
a `ping` RPC sent with empty `args:[]` crashes `God.ping` (`cb is not a function`), the domain
handler spawns `node bin/pm2 update` detached, and that child hangs forever waiting for a
`launchDaemon` handshake that never arrives (its intermediate parent is dead). Each daemon
crash leaves one permanently-hung `pm2 update` client.

- 119 hung processes found, all created in a ~21-second burst at 11:08 AM today.
- All matched `node ...\pm2\lib/../bin/pm2 update` exactly; parents dead (PIDs reused by
  unrelated processes). No scheduled task, PM2 module (only pm2-logrotate), repo script,
  or `.hydi` script invokes `pm2 update` — confirmed by search.
- Killed all 119 with the PS 5.1-safe `Win32_Process` + CommandLine match. Count now 0,
  no respawn over 15s+ observation. The defect remains in PM2 itself: any future empty-args
  `ping` RPC will spawn one new hung child. Mitigation is behavioral — don't call PM2's RPC
  `ping` directly; the `pm2 ping` CLI is safe (sends `args:[{}]`).

## 2. Kill result
- Before: ~1.5 GB free RAM, 152 node processes.
- After: all 119 gone; RAM partially recovered (Windows reports ~0.7–1.5 GB free — the box is
  genuinely RAM-tight at 15.7 GB total; the win was process-count and CPU, not huge RAM).
- Side effect observed: the pending `pm2 update` handshake finally completed — PM2 daemon
  restarted itself (~20:30), which is what flushed the corrupted app bookkeeping below.

## 3. Split-brain resolved — PM2 owns all four ports
Root cause of the heidi-core EADDRINUSE loop was **corrupted PM2 bookkeeping**, not just orphans:
every fork that won :3459 was immediately marked failed by God and replaced; the winner survived
as an untracked orphan (verified via heidi_events `boot` payloads — serving pid differed from
PM2's tracked pid). Same corruption pattern hit `ursula-local` (805 restarts) and `ollama-serve`
(789 restarts, plus 3 concurrent `ollama serve` binaries fighting :11434).

Fix applied per app: kill verified orphan → `pm2 delete` → `pm2 start ecosystem.config.js --only <app>`.

| App | Before | After | Port proof |
|---|---|---|---|
| heidi-core | waiting restart, ↺329+, orphan holders | **online pid 38208, ↺0** | :3459 `/health` 200, `status=healthy brain=connected`, uptime >14 min stable |
| heidi-web-standalone | waiting restart ↺43, stale-build orphan | **online pid 45684** | :3000 `/heidi` + `/api/health` 200 (earlier verified local + Tailscale) |
| ursula-local | waiting restart ↺805 | **online pid 31040, ↺0** | :3100 → HTTP 200 |
| ollama-serve | waiting restart ↺789, 3× `ollama serve` procs | **online pid 45988, ↺0** | :11434 `/api/tags` 200 |
| heidi-mobile-chat | waiting restart ↺0 | unchanged | :3006 down — needs `HEIDI_MOBILE_TOKEN` in PM2 env (pre-existing, not fixed) |

Orphans killed (all verified by command line first): pm2-update×119, next:3000 pid 29948,
next:3100 pid 6140 (wedged since 11/11), heidi-core fork pids 2400/42316/17940/50160 (each
verified via boot-event pid + parent=PM2 daemon), `ollama serve` pids 9152/36780/37720.

`pm2 save` run — dump.pm2 now holds all 26 apps including the three re-registered ones.

## 4. Model check
- `ollama show qwen2.5:3b`: architecture qwen2, 3.1B params, **quantization Q4_K_M** — exactly the
  instruct Q4_K_M variant required. **No pull needed.**
- Generate probe after cleanup: `qwen2.5:3b` responded `"ok"` — first call 44.7s (cold model
  load on a RAM-tight box); warm calls will be far faster. `OLLAMA_MAX_LOADED_MODELS=1`,
  `KEEP_ALIVE=2m` via the PM2 wrapper env.

## 5. Boot path — one path, documented
- `\PM2Resurrect` (logon) → `C:\Users\Owner\.hydi\hydi-boot-resurrect-launcher.ps1` →
  **`scripts/hydi-boot-resurrect.ps1` (NEW)** → waits ≤5m for Docker, ≤3m for Supabase
  (:54322/:54321), then `pm2 resurrect` → `pm2 save` → `pm2 ping` → app census. Logged to
  `logs/hydi-boot-resurrect.log`. PS 5.1 syntax-verified.
- Manual bring-up: `start-heidi-everything.ps1` — already a thin PM2 wrapper (preflight →
  `pm2 resurrect` → `pm2 start ecosystem.config.js` → port probes). No change needed.
- **Retired (documented, not deleted):** `C:\ProtoForge_Ecosystem\start-heidi-everything.ps1`
  — the legacy 4-component launcher (Forge Loop, Heidi Bridge :5050, mobile :3006, Ursula
  docker). It is outside the repo, not idempotent, and describes a stack that no longer
  matches reality. Do not use; PM2 is the only process manager.
- `dump.pm2` verified: 26 apps present post-save.

## 6. Watchdog split-brain follow-up — implemented
`scripts/watchdog-split-brain.js`: when `listenerPids(port)` returns empty (the live blind
spot), the check no longer skips — endpoint-ok + PM2 app not `online` now flags SPLIT-BRAIN
with `orphanPids: []` and reason "listener table unavailable". Kill proposals are only filed
when an actual orphan PID is known. New unit test covers the fallback; **5/5 tests pass**.
Deployed via `pm2 restart hydi-watchdog` (pid 41164).

**Why my shell sees zero LISTENING sockets:** the Devin CLI shell on this host is sandboxed —
`netstat -ano` returns no LISTENING rows and `Get-NetTCPConnection` returns `OwningProcess=0`
for foreign processes (non-elevated + filtered TCP table). TCP connect probes and curl work
because they don't need the table. On an unsandboxed Frank shell, netstat should work — but
the fallback now covers the case where it doesn't.

## 7. heidi_events / heidi_missions characterization
- `heidi_events`: 281k rows since 2026-08-22 (~3 months, ~200–450/hour typical).
  Top types: `mission_transition` 87.8k (31%), `cognitive_cycle` 77.2k (27%),
  `agent_heartbeat` 47.0k (17%), `mission_sweep` 45.8k (16%), `agent_supervision` 9.8k.
  **Crash-loop noise:** 337 of 340 lifetime `boot` events occurred in the last 3 hours —
  today's heidi-core restart storm was ~99% of all boot events ever written. The event firehose
  itself is chronic (mission/cognitive churn) but the acute noise was the boot storm, now stopped.
- `heidi_missions`: ~11.5k rows, 11,527 `succeeded` / 3 `failed` / 2 `timed_out` / 1 `running`.
  Volume ~125/day, success rate ~99.9% — healthy churn, not noise.

## Remaining known issues
- `heidi-mobile-chat` :3006 still down — requires `HEIDI_MOBILE_TOKEN` in PM2 env (not provided).
- heidi-core `/health` `deps.store` intermittently reports `fetch failed` (transient Supabase
  latency under load); status stays healthy.
- `protoforge-core` :3005 shows intermittent watchdog timeouts (FAILURE_SUSPECTED, no recovery).
- PM2 empty-args `ping` defect remains — one hung `pm2 update` child per future daemon crash.
- C: free ~15–18 GB; RAM 15.7 GB total is the binding constraint for local inference.

HEIDI_ALLOW_EXEC=false confirmed unchanged (ecosystem env + live).
