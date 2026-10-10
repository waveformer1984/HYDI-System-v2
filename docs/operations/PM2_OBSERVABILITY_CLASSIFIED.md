# PM2 Management-Plane Observability — `pm2 list` Hang

**Status:** `PM2_OBSERVABILITY_CLASSIFIED`
**Authoritative forensic record:** [`PM2_OBSERVABILITY_AGENT_H.md`](./PM2_OBSERVABILITY_AGENT_H.md) — read that file for the full evidence chain. This document is the corrected executive summary.

> **Correction note:** an earlier draft of this summary (written before the Agent H
> forensics completed) attributed the daemon crash to "concurrent IPC load" and
> claimed the event loop died. Both were wrong. The crash was a single
> empty-args `ping` RPC; the event loop and pub-bus stayed alive. It also missed
> the decisive current fact — **the live daemon now supervises ZERO apps** — and
> treated `pm2 ping → pong` as "management plane restored," which is misleading.
> Corrected below.

---

## Verdict

The `pm2 list` hang is a **management-plane failure that evolved through three phases**, not a single bug. It is **not fixable inside HYDI code** (the defects live in PM2 7.0.1 and the host's WMI/PowerShell layer). Recovery requires **LIVE_ACTION**.

| Phase | Window | State |
|---|---|---|
| **A — original symptom** | before ~14:45 | `pm2 list`/`jlist`/`describe`/`monit` hang/slow: `getMonitorData → pidusage@4.0.1 → wmic (absent on this host) → gwmi → powershell Get-WmiObject` is pathologically slow (**15–25 s+ per call**, measured). This is the user's reported "no output for 30 s+" and **will recur on the new daemon as soon as apps exist**. Environmental, not HYDI code. |
| **B — daemon crash** | 14:46:02 | Daemon (20836) threw `TypeError: cb is not a function` inside `God.ping` (`ActionMethods.js:208`), triggered by a `ping` RPC frame with **`args:[]`**. Domain handler spawned `pm2 update` (27140) and parked awaiting its exit. rep dispatch went intermittently dead; **event loop + pub-bus stayed alive**. |
| **C — daemon replaced, zero supervision** | 14:54 → now | `pm2 update` killed all 8 ProcessContainerForks + old daemon; new daemon **17776** spawned via a detached intermediate whose `{online:true}` handshake went nowhere → **`resurrect` never ran → it manages ZERO apps** (`pm2 jlist` → `[]`). |

## The crash — precise mechanism (corrected)

`pm2-axon-rpc` `Server.onmessage` pushes a `reply` callback onto `msg.args` then calls `fn.apply(null,args)`. `God.ping` is `function(env,cb){ return cb(...) }`. A `ping` sent with **empty `args:[]`** becomes `God.ping(reply)` → `env=reply`, `cb=undefined` → `cb()` throws `TypeError`. The official `pm2 ping` CLI sends `args:[{}]` and is **safe**; the crash requires a raw `client.call('ping')` with no args. **Agent H disclosed its own diagnostic used exactly that call shape and is the most likely trigger** (other concurrent probers can't be ruled out). Either way the PM2 defect is real: one empty-args `ping` fatally wedges the daemon.

## Critical current state (~15:30, verified)

- Daemon **17776** healthy (`pm2 ping`→`pong` 0.104 s) but **supervises ZERO apps** — `pm2 jlist` → `[]`. `pm2 ping→pong` therefore does NOT mean the management plane is functional; it means a daemon with nothing to manage is reachable.
- Orphaned work-processes still serve: **:3000→29100** (manual `npm run dev`, NOT a PM2 child), **:3005→27392** (protoforge-core), **:3006→31248** (boot-agent orphan) — all HTTP 200 but **not PM2-supervised**. heidi-daemon chain dead.
- **Zombies:** `pm2 update` 27140 (hung ~50 min) + **6× `pm2 restart heidi-web --update-env`** (spawned ~30 s apart by the watchdog→RecoveryEngine loop; the exec 30 s timeout killed only the cmd shim, the node processes survived).
- Watchdog metrics: `recoveryAttempts=40, successful=0` — **worse than the 0/29 baseline** (the loop keeps spawning doomed restarts into a dead management plane).

## Health reporting under a degraded management plane

Mostly truthful, with two real gaps:

- **Good:** watchdog/health endpoints don't shell to `pm2` (HTTP + Supabase `system_dashboard` only); `true-system-health.js` uses no `pm2`. Component health truth does not depend on `pm2 list`.
- **Zombie leak:** `DependencyAwareRestartExecutor.ts:204` `exec('pm2 restart --update-env',{timeout:30000})` leaves orphaned node processes on timeout (the 6 zombies); `scripts/pm2-restart.js:46` `execSync` has **no timeout**.
- **Mislabel:** `hydi-doctor.js:104` (10 s), `certification-harness.js:73` (5 s), `hydi-qualify-local.js:103` (10 s) all use timeouts **< the 15–25 s gwmi cost** → they report "PM2 not detected" on a *healthy* daemon. Honest degradation, wrong cause label.
- **Missing classification:** a wedged management plane silently morphs into "component recovery failed" + zombie accumulation. Needs a distinct `PM2_MANAGEMENT_PLANE_DEGRADED` state + a `pm2 ping`-with-hard-timeout watchdog probe (with the `{}` arg — see above).

## Code-fixable vs LIVE_ACTION

**Not fixable in HYDI code:** the `God.ping` empty-args crash; post-domain-error rep wedge; WMI/powershell slowness; `pidusage`'s wmic→gwmi fallback.

**Mitigations (code track):**
- Never emit `client.call('ping')` with empty args anywhere; always `call('ping', {}, cb)`.
- Serialize PM2 control calls (single owner/mutex) so restart/recovery can't race the daemon.
- Add tree-kill + timeout to every `pm2` exec (`DependencyAwareRestartExecutor.ts:204`, `pm2-restart.js:46`).
- Watchdog `pm2 ping` probe (hard timeout) → `PM2_MANAGEMENT_PLANE_DEGRADED` classification.

**LIVE_ACTION_REQUIRED (full detail in Agent H file §7):**
1. Kill zombie clients: 27140 + the 6 `pm2 restart` PIDs (31504/33448/33168/23188/31452/23752).
2. Stop orphaned port-holders: 29100 chain, 27392, 31248, poller chain — brief :3000/:3005/:3006 downtime to avoid EADDRINUSE.
3. `pm2 resurrect` (dump.pm2 from 14:54:16 is complete and pre-crash) + `pm2 save`. Verify `pm2 jlist` shows 8 online apps and ports answer under PM2-owned PIDs.

## Bottom line

`pm2 list` hang = **Phase A**: `pidusage`→wmic-absent→gwmi slowness (original symptom, environmental, **will recur**). **Phase B**: empty-args `ping` RPC wedged the daemon (a real PM2 bug). **Phase C**: the auto-update replaced the daemon but `resurrect` never ran → **all 8 apps now unsupervised**, with zombies and orphaned port-holders. This is a LIVE_ACTION gate, and the system's supervision state is **worse than the baseline** that found only two orphans — it must be surfaced, not smoothed over.
