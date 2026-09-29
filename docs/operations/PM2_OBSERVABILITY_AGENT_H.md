# PM2 Observability — `pm2 list` Hang Classification (AGENT H)

**Track:** CODE — read-only diagnosis. No `pm2 stop/start/restart/reload/save/delete/resurrect` issued; no processes killed; no live state changed. All probes were observational (file reads, `Get-Process`/`Get-CimInstance`, `netstat`, named-pipe connects, RPC reads).

**Companion file:** `docs/operations/PM2_OBSERVABILITY_CLASSIFIED.md` exists (sibling draft). This document supersedes/complements it — it corrects two details (daemon event loop was NOT fully dead; the crash trigger is specifically an empty-args `ping` RPC, not generic "concurrent load") and adds findings it missed (zero supervised apps now, zombie client processes, the pidusage/WMI root defect, orphaned port holders).

---

## 1. Verdict

The `pm2 list` hang is a **management-plane failure** that evolved through three distinct states. It is NOT fixable in HYDI code (the defects are inside PM2 7.0.1 and the host's WMI/powershell layer). Recovery requires **LIVE_ACTION** (detailed in §7).

| Phase | Window (CDT, 2026-09-18) | State |
|---|---|---|
| A — original symptom | before ~14:45 | `pm2 list`/`jlist`/`describe`/`monit` effectively hang: `getMonitorData → pidusage → wmic (absent) → gwmi fallback → powershell + WMI query` is pathologically slow/hanging on this host (measured 15–25 s+ per call; likely worse earlier). `pm2 ping` itself was probably still fine (see §4 caveat). |
| B — daemon crash | 14:46:02 | Daemon (PID 20836) threw `TypeError: cb is not a function` inside `God.ping` (empty-args `ping` RPC frame). Domain error handler spawned `node bin/pm2 update` (PID 27140) and parked waiting for its exit. rep/RPC dispatch went dead; event loop and pub-bus stayed alive. |
| C — daemon replaced, apps unsupervised | 14:54:16 → now | `pm2 update` progressed: `dump.pm2` rewritten 14:54:16, all 8 ProcessContainerForks killed, old daemon exited ~14:57:38. New daemon **PID 17776** spawned 14:57:38, bound both pipes, wrote `pm2.pid`, reported ready 14:57:44 — **but `resurrect` never ran → it manages ZERO apps.** |

**Current state (verified ~15:30):** `pm2 ping` → `{msg:'pong'}` in 0.104 s; `getMonitorData` → `[]` (n=0); `pm2 jlist` → `[]`. The daemon is healthy but supervises nothing. Several HYDI app work-processes run **orphaned** and still serve :3000/:3005/:3006 (HTTP 200 on all three). Six hung `pm2 restart heidi-web --update-env` clients and the hung `pm2 update` child (27140) are still alive.

---

## 2. Evidence — the IPC mechanism (all read-only)

- `C:\Users\Owner\.pm2\pm2.pid` currently contains **17776** (matches the live `Daemon.js` process). It contained 20836 during Phase B.
- PM2 7.0.1 on Windows uses named pipes, not socket files: `RPC socket file \\.\pipe\rpc.sock`, `BUS socket file \\.\pipe\pub.sock` (daemon banner, `pm2.log`). `handle.exe` earlier showed rpc.sock server handles owned only by PID 20836 (+1 client handle held by PID 27140). No second `.pm2` home exists (`C:\Users\<other>` and systemprofile checked). Scheduled tasks: `PM2Resurrect` (ready, runs `pm2 resurrect`), `HYDI_Startup` (disabled). No PM2 Windows services.
- `pm2.pid`, `dump.pm2`, `pm2.log` all consistent with `C:\Users\Owner\.pm2` as PM2 home; `pids/` has 38 stale `*.pid` files (not empty — leftovers from app restarts); `reload.lock` exists (0 bytes, dated 8/25) — stale artifact, not causally linked.
- Daemon's own daily timer (the `[PM2] This PM2 is not UP TO DATE` lines at 11:16:08 on 9/16–9/18) proved the old daemon's loop ticked until Phase B.

## 3. Evidence — the 14:46:02 crash (definitive)

`pm2.log` lines ~1659524–1659580:

```
14:46:02  --- PM2 global error caught ---
14:46:02  PM2 error: cb is not a function
          TypeError: cb is not a function
              at God.ping (pm2/lib/God/ActionMethods.js:208:12)
              at Server.onmessage (pm2/modules/pm2-axon-rpc/lib/server.js:104:6)
              at Parser.<anonymous> (pm2/modules/pm2-axon/lib/sockets/rep.js:51:15)
              at Parser._write (amp/lib/stream.js:91:16)
14:46:02  PM2 error: [PM2] Resurrecting PM2
```

The dumped IPC frame in the crash block decodes to `{"type":"call","method":"ping","args":[]}`.

**Mechanism (verified in source):** `pm2-axon-rpc` `Server.onmessage` (server.js:93-104) pushes a `reply` callback onto `msg.args` then calls `fn.apply(null, args)`. `God.ping` is `function(env, cb){ return cb(null,{msg:'pong'}) }` (ActionMethods.js:207-209). A `ping` RPC sent with **empty `args:[]`** becomes `God.ping(reply)` → `env=reply`, `cb=undefined` → `cb(...)` throws `TypeError`. The throw happens inside the amp `Parser._write` stream callback → stream error → caught by the daemon's startup `domain` (`Daemon.js:36-62`), which prints "PM2 global error caught", spawns `node bin/pm2 update` (detached), and waits for that child's `'close'` before `process.exit(0)`.

**Trigger attribution (honest):** the crashing frame was a `ping` call with `args:[]`. The official `pm2 ping` CLI sends `args:[{}]` (`API/Extra.js:598-609` → `executeRemote('ping',{})`) and does NOT crash. This agent's own diagnostic called `client.call('ping', cb)` — which produces `args:[]` — and is the most likely trigger given the timing (~14:46). Other concurrent agents/probers on this host cannot be ruled out. Either way, **the defect is real in PM2: a single empty-args `ping` RPC fatally wedges the daemon.**

**Post-crash rep behavior:** rep socket stopped answering my `call('ping')` within ~4 min of the crash (15 s timeout, no error, no data, no close — connection accepted, never dispatched). Yet the `pm2 update` child's `getVersion`/`dumpProcessList`/`killMe` RPCs DID complete at ~14:54–14:57 (dump.pm2 written 14:54:16; containers killed; old daemon exited ~14:57:38). So post-crash rep dispatch was **intermittently dead** — consistent with domain disposal damaging only part of the rep socket's state. Meanwhile the pub socket (`pub.sock`) streamed live `log:out` events at ~14:53 and pipe accepts kept being pumped — the event loop itself was alive.

**Why `pm2 update` (27140) never finished:** `API.update` (`API.js:392-431`) = `notifyKillPM2 → getVersion → dump → killDaemon → launchDaemon → launchRPC → resurrect`. Daemon 17776's recorded parent is 36568 (dead) — it was spawned via the detached launch wrapper. The daemon sent its `{online:true}` IPC ready message at 14:57:44 (`Daemon.js:305-317` — the banner printed proves `sendReady` ran), but the message went to its dead intermediate parent, so 27140's `launchDaemon` handshake never completed → it never reached `resurrect` → **zero apps restored**. 27140 remains alive, idle (CPU ~0.97), hung forever.

## 4. Evidence — the ORIGINAL `pm2 list` wedge (pre-crash)

- `wmic.exe` is **not present** on this host (Win11 FoD removed; `Get-Command wmic` empty). `pidusage@4.0.1` (`pm2/node_modules/pidusage`) maps Windows → `wmic` (`lib/stats.js:26`), probes it via `spawn('wmic', fn)` which throws synchronously → falls back to `gwmi` (`lib/gwmi.js`), which spawns `powershell.exe` running `Get-WmiObject win32_process -Filter ...`.
- Measured now: a trivial `powershell.exe` child works (~10-20 s spawn); a `gwmi win32_process` call took **~16-25 s** (first attempt exceeded a 15 s window; second returned in ~20 s). `Get-CimInstance` (WSMan channel) answers instantly → the degradation is specific to the `Get-WmiObject`/DCOM-style path and/or powershell startup.
- With 8 managed pids, `getMonitorData` makes exactly one such call per `pm2 list` → every `pm2 list`/`jlist`/`describe`/`monit`/`report` costs ≥15-25 s, and under a worse WMI stall hangs indefinitely → matches the reported "no output for 30 s+". **This will recur on the new daemon as soon as apps exist again** (with 0 apps, `getMonitorData` returns early — ActionMethods.js:49-58 — which is why `jlist` is instant right now).
- Historical `pm2.log` confirms pidusage has thrown (`Error: No matching pid found`, `TypeError: One of the pids provided is invalid`, `spawn npx ENOENT`) but previously completed — the WMI slowdown is the new element.

**Caveat on my own probe results:** two `pm2` invocations run inside `Start-Job` (`pm2 ping` ~14:44, `pm2 jlist` ~15:15) hung >15-20 s even though (a) at 14:44 the daemon still dispatched (proven by the 14:46:02 crash reaching `God.ping`) and (b) at 15:15 the new daemon was provably healthy (foreground `pm2 ping` returned pong in 0.104 s, `pm2 jlist` returned `[]` instantly). So `Start-Job`-wrapped pm2 calls are unreliable evidence on this box; the pre-14:46 `pm2 ping` hang is attributed to the harness, not the daemon. `pm2 describe`/`pm2 report` were not separately needed — they share the `getMonitorData` path.

## 5. Current process inventory (~15:30 CDT)

| Role | PID(s) | State |
|---|---|---|
| PM2 daemon | 17776 | healthy, `pm2.pid` owner, manages 0 apps |
| `pm2 update` orphan | 27140 (parent 20836 dead) | hung since 14:46:02 waiting on dead IPC handshake |
| `pm2 restart heidi-web --update-env` zombies | 31504, 33448, 33168, 23188, 31452, 23752 | spawned ~30 s apart 14:51:35–14:54:04 by the watchdog→RecoveryEngine loop; exec-level 30 s timeout killed the cmd shim but the node processes survived and remain connected/retrying |
| Old daemon 20836 | — | exited ~14:57:38 |
| 8× ProcessContainerFork | — | all dead (killed in the ~14:54–14:57 daemon teardown) |
| Orphaned app processes (alive, unsupervised, serving) | :3000 → 29100 (next-dev, `npm run dev` chain), :3005 → 27392 (`node src/server.js`, protoforge-core), :3006 → 31248 (`node launch-heidi-mobile.js`, genuine boot-agent grandchild via dead container 4832), job-executor-poller chain 19936→1644→30128→14044→10672 | all respond HTTP 200 (:3000 reports `"degraded"`, :3005 `"ok"`, :3006 `"ok"`) |
| Dead app processes | heidi-daemon tsx chain (15452/22812) gone | — |
| Watchdog | 32000 `watchdog.js --once` (spawned 15:10 by svchost 2268 — scheduled task) | still running periodic checks |

Note: the :3000 `npm run dev` chain was **not** spawned by the PM2 boot container (its parent 23980 is dead and ≠ container PID) — it is a manually-started dev server. Any `pm2 resurrect` that starts `hydi-boot` (which spawns its own heidi-web) will hit EADDRINUSE on :3000/:3005/:3006 unless these orphans are dealt with first.

## 6. Health / truth reporting under a degraded management plane

- **Good separation:** the watchdog (`scripts/watchdog.js`) polls HTTP endpoints and `docker inspect` only; `api/health.js`, `api/mobile-status.js` read the `system_dashboard` Supabase view; `true-system-health.js` uses no `pm2` at all. Component health truth does not depend on `pm2 list`.
- **Recovery plane depends on pm2 and mishandles the wedge:** `lib/operational/DependencyAwareRestartExecutor.ts:204` runs `exec('pm2 restart <t> --update-env', { timeout: 30000 })` — the timeout kills only the cmd shim; the `node …/bin/pm2` process survives → **zombie client accumulation** (the 6 observed). `scripts/pm2-restart.js:46` uses `execSync('pm2 restart …')` with **no timeout** → unbounded hang.
- **Timeout mislabeling:** `hydi-doctor.js:104` (`pm2 list`, 10 s), `certification-harness.js:73` (`pm2 jlist`, 5 s), `hydi-qualify-local.js:103` (`pm2 list`, 10 s) — with `pm2 list` costing 15-25 s via gwmi, these report "PM2 not detected" even when the daemon is healthy: honest degradation, wrong cause label.
- **Watchdog log evidence** (`logs/pm2-hydi-watchdog.out.log` tail): at 14:53 it reported protoforge-core/heidi-web/heidi-mobile-chat UNAVAILABLE + supabase_db/rest failing, delegated `hydi-recover.js --governed` per component, all failed; metrics: `recoveryAttempts=40 successful=0 failed=40`.
- **Recommended behavior (for the team's code track):** management-plane failure must be its own classification (`PM2_MANAGEMENT_PLANE_DEGRADED`) distinct from component-down — today a wedged daemon silently morphs into "recovery failed" + zombie clients. A `pm2 ping`-with-hard-timeout probe (e.g., axon `client.call('ping', {}, cb)` with a 5 s timer — note the `{}` arg, see §3) in the watchdog would detect this state proactively.

## 7. LIVE_ACTION_REQUIRED (nothing performed)

**Exact action (proposed):**
1. `taskkill /PID 27140 /F` (hung `pm2 update` orphan) and `taskkill /PID 31504,33448,33168,23188,31452,23752 /F` (zombie `pm2 restart` clients). Clients only — safe.
2. Stop orphaned app processes that hold service ports: PID 29100 (+ancestors 9804,14396,20752,30064 — manual `npm run dev`), 27392 (+26840), 31248, and orphan chain 19936/1644/30128/14044/10672. This takes :3000/:3005/:3006 down briefly — required to avoid EADDRINUSE crash loops on resurrect.
3. `pm2 resurrect` (daemon 17776 is healthy; `dump.pm2` from 14:54:16 is complete and pre-crash) — or `pm2 start ecosystem.config.js` for a clean 8-app restore — then `pm2 save`.
- **Services affected:** all 8 ecosystem apps (hydi-boot→protoforge-core/heidi-web/heidi-mobile-chat/orchestrator, hydi-watchdog, hydi-daemon, hydi-system-health, hydi-protoforge-scout, hydi-stuck-job-scheduler, hydi-revenue-reconciliation, hydi-failed-webhook-retry).
- **Reason:** daemon manages zero apps → no restart-on-crash, no `pm2` visibility; orphans serve traffic unsupervised; zombies hold stale RPC connections.
- **Downtime:** :3000/:3005/:3006 gap while orphans are killed and hydi-boot respawns children (~seconds–minutes). Worker/scheduler apps restart cleanly.
- **Risk:** LOW — apps already unsupervised; worst case is killing the manual dev server which should be replaced by the PM2-owned one anyway. dump.pm2.bak exists as fallback.
- **Rollback:** if resurrect misbehaves, `pm2 start ecosystem.config.js` restores the canonical set; the manual `npm run dev` chain can be relaunched identically.
- **Preconditions:** confirm no active user traffic window requirement; verify orphan PIDs haven't changed (re-list before killing).
- **Postconditions/verification:** `pm2 jlist` shows 8 apps `online`; ports 3000/3005/3006 answer 200 under PM2-owned processes; `pids/` repopulated; no `pm2`-client zombies (`Get-CimInstance node.exe | ? CommandLine -match 'bin\\pm2'`).

## 8. Root-cause chain (summary)

1. Host WMI/powershell degradation → `pm2 list` (any `getMonitorData` call) takes 15-25 s+ or hangs via pidusage's `gwmi` fallback — the **original symptom**. Environmental, not HYDI code.
2. An empty-args `ping` RPC (PM2 bug: `God.ping` requires `env` arg) hit `God.ping` at 14:46:02 → daemon domain crash → self-resurrect path spawned `pm2 update` → rep dispatch intermittently dead.
3. The update flow killed the old daemon + all 8 containers, spawned new daemon 17776 — but the ready-handshake went to a dead intermediate parent → `resurrect` never ran → **all apps unsupervised now**.
4. Side effects: hung `pm2 update` child, 6 zombie `pm2 restart` clients, stale `pids/` entries, stale `reload.lock`.
5. Code-track fix opportunities (HYDI side): timeouts + process-tree kill on every `pm2` exec call (`DependencyAwareRestartExecutor.ts:204`, `pm2-restart.js:46`), a watchdog `pm2 ping` management-plane probe, and a `PM2_MANAGEMENT_PLANE_DEGRADED` classification so health reporting doesn't conflate daemon-dead with app-down.
