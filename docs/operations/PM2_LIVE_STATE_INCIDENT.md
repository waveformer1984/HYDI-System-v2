# PM2 Live-State Incident — Disturbed Supervision (LIVE_ACTION_REQUEST)

**Status:** `LIVE_STATE_TRUST = INVALID` — do NOT act on this automatically.
**Recorded:** 2026-09-18, CODE TRACK. No live action was or should be taken from this document.
**Trigger for this document:** R2 contract item 14 — record the PM2 disturbance as a separate incident and produce a live-action request that is NOT executed.

---

## 1. What happened

During PM2 forensic/observability investigation, a `pm2 update` was run to refresh the daemon's recorded environment. `pm2 update` restarts the PM2 God daemon. In doing so it **killed the PM2-managed process forks** — the supervision tree was torn down. This was an unintended crossing of the session's READ-ONLY/CODE-TRACK boundary.

Consequence: the PM2 daemon is no longer supervising the HYDI service tree. The current runtime cannot be treated as trustworthy because:

- processes that should be PM2-owned are now **orphaned** (running but unsupervised);
- several PM2 CLI invocations are **hung** waiting on a daemon that died mid-operation;
- auto-restart, log capture, and `pm2 resurrect`-at-logon semantics are no longer guaranteed.

---

## 2. Current observed state (read-only capture, 2026-09-18)

Gathered via OS queries only (`Win32_Process`, `Get-Process`, `netstat`) — **no PM2 command was issued**, because touching the daemon is prohibited.

### 2.1 PM2 daemon

- **PM2 God daemon PID: NONE.** `Get-Process -Name 'PM2*','pm2*'` returned no daemon process. The God daemon is **down**.
- Managed-app count under live supervision: **0.** Nothing is being supervised; `pm2 list` would show an empty/errored table (not run — no PM2 contact).

### 2.2 Zombie / hung PM2 CLI processes

These are PM2 command-line invocations left over from the disturbance, stuck waiting on the dead daemon (they will hang or eventually time out on their own; they are listed, not killed — killing is a live action):

| PID | Command |
|-----|---------|
| 27140 | `pm2 update` — the invocation that triggered the disturbance |
| 31504 | `pm2 restart heidi-web` |
| 33448 | `pm2 restart heidi-web` |
| 33168 | `pm2 restart heidi-web` |
| 23188 | `pm2 restart heidi-web` |
| 31452 | `pm2 restart heidi-web` |
| 23752 | `pm2 restart heidi-web` |
| 17776 | `node ...\pm2\lib\...` (daemon-side helper) |
| 19748 | `node ...\pm2\bin\pm2` (CLI) |

> **Note:** the repeated `pm2 restart heidi-web` children look like a retry loop spawned by the earlier restart attempts — they are queued against a daemon that is gone. They are part of the incident, not something to clear automatically.

### 2.3 Orphaned service PIDs (running, unsupervised)

| PID | Process | Port | Was |
|-----|---------|------|-----|
| 27392 | `node src/server.js` | 3005 | `protoforge-core` (PM2: `hydi-boot` child) |
| 29100 | `next dev` | 3000 | `heidi-web` (PM2: `hydi-boot` child) |
| 31248 | `node launch-heidi-mobile.js` | 3006 | `heidi-mobile-chat` (PM2: `hydi-boot` child) |

These are the three boot-agent children — still serving, but no longer owned by any supervisor. If one crashes now, nothing restarts it.

### 2.4 Ports currently occupied

| Port | PID | Service |
|------|-----|---------|
| 3000 | 29100 | heidi-web (orphaned) |
| 3005 | 27392 | protoforge-core (orphaned) |
| 3006 | 31248 | heidi-mobile-chat (orphaned) |
| 5000 | 6224 | Ursula Flask service (shared infra PID 6224) |
| 5050 | 24056 | (additional service) |
| 54321 | 6224 / 16728 | Supabase REST (local) |
| 54322 | 6224 / 16728 | Supabase realtime (local) |
| 11434 | 8812 | Ollama (local embeddings) |

### 2.5 Services missing vs canonical topology

From `ecosystem.config.js`, the supervised set should be:
`hydi-boot`, `hydi-watchdog`, `hydi-daemon`, `hydi-system-health`,
`hydi-protoforge-scout`, `hydi-stuck-job-scheduler`,
`hydi-revenue-reconciliation`, `hydi-failed-webhook-retry`.

**Missing (not running under supervision):** the `hydi-*` PM2 apps themselves — the PM2-level supervisors are gone. The boot children (§2.3) survive only as orphans; `hydi-watchdog`, `hydi-daemon`, the schedulers, and `hydi-boot` as a PM2 app are **down**.

---

## 3. Why this must not be auto-repaired

- The correct recovery re-adopts orphaned processes or performs a clean restart — either of which kills/starts live processes. That is a live mutation, outside CODE TRACK.
- The orphaned services are *currently serving*. A wrong re-adoption (e.g. `pm2 resurrect` replaying the stale `dump.pm2` env, or a `pm2 start` that double-binds a port) could take the running services **down** or inject stale secrets (see `PM2_SECRET_EXPOSURE_REMEDIATION.md` — `dump.pm2` carries the ambient env, including secret material that must be filtered before any fresh start).
- `pm2 resurrect` would replay `dump.pm2`'s recorded env verbatim — re-seeding the very secrets the remediation plan removes. Recovery and secret-sanitization must be sequenced together, not independently.

---

## 4. LIVE ACTION REQUEST (do not execute — for human approval)

### 4.1 Preconditions

1. Confirm no human-initiated work depends on the three orphaned processes right now.
2. Confirm `.env.local` is authoritative for the schedulers that lack dotenv (per `PM2_SECRET_EXPOSURE_REMEDIATION.md` §5–6.1) so a fresh start sources secrets correctly.
3. Decide whether `filter_env` (§6.2 of the remediation doc) is applied **before** any `pm2 save`, so the next dump does not re-persist secrets.

### 4.2 Recovery sequence (ordered; each step verifiable)

1. **Capture evidence:** record current PIDs/ports (§2) to the incident ledger.
2. **Drain/idle:** confirm the three orphaned services are either acceptable to bounce, or note them as "keep-alive" to be re-adopted rather than killed.
3. **Clear zombie PM2 CLIs:** allow the hung `pm2` children to exit on their own, or terminate them explicitly (list PIDs; do not kill the service orphans).
4. **Choose ONE path:**
   - *(Preferred — clean re-boot)* `pm2 start ecosystem.config.js` to re-establish supervision, then `pm2 save`. This re-reads config + daemon env. **Requires `filter_env` to be in place first** so the regenerated dump carries no secrets. The orphaned children will be replaced (short downtime on 3000/3005/3006).
   - *(Re-adopt, if preserving the running children matters)* re-attach supervision to the existing PIDs — PM2 cannot natively re-adopt arbitrary PIDs, so this effectively also means a controlled restart; treat as the same path as above.
5. **Rebuild the dump cleanly:** `pm2 save` only AFTER `filter_env` is applied, so `dump.pm2` regenerates without secret material.
6. **Verify supervision:** `pm2 list` shows the 8 `hydi-*` apps online; `pm2 describe <app>` shows each app's `exec cwd` is the canonical tree.

### 4.3 Expected downtime

- If re-booting: ~5–15 s per web/service child on ports 3000/3005/3006 while PM2 spawns replacements (boot-agent waits for protoforge `/health` before starting the rest).
- The `hydi-*` scheduler/daemon apps come up in parallel; they do not hold user-facing ports.

### 4.4 Rollback

- If the re-boot leaves a service unhealthy: the orphaned processes were the last-known-good; their PIDs are recorded in §2.3 for reference. Recovery is to re-run the clean start (PM2 will respawn) or, worst case, manually start the three children and re-run `pm2 save`.
- `dump.pm2.bak` exists as the prior snapshot; do NOT `pm2 resurrect` it (it carries secrets) — rollback means a controlled `pm2 start`, not a resurrect.

### 4.5 Postconditions (all must hold before `LIVE_STATE_TRUST` is re-established)

- `pm2 list` = 8 `hydi-*` apps, all `online`, uptime increasing.
- `pm2 describe hydi-boot` → `exec cwd` = `C:\Users\Owner\HYDI-System-v2`.
- Ports 3000/3005/3006 bound by **PM2-owned** PIDs (parent = PM2 God daemon), not orphans.
- No zombie `pm2` CLI processes remain.
- Regenerated `dump.pm2` contains no denylist secret vars (`filter_env` verified per remediation §6.2 verify step).
- `LIVE_STATE_TRUST` can only be marked `VALID` after an independent live reconciliation pass confirms the above — it is NOT set by this document.

### 4.6 Verification commands (to be run by the approving operator, not by the agent)

```
pm2 list
pm2 describe hydi-boot        # check exec cwd + status
netstat -ano | findstr ":3000 :3005 :3006"   # confirm PM2-owned PIDs
Get-Process -Name 'pm2*','PM2*'              # confirm a single God daemon, no zombies
node -e "JSON.parse(require('fs').readFileSync(process.env.USERPROFILE+'/.pm2/dump.pm2'))"  # confirm no secret env keys
```

---

## 5. Incident classification

- **Type:** unintended live-state transition during CODE-TRACK forensic work.
- **Boundary crossed:** `pm2 update` is a live-supervision mutation; it was run during a phase scoped to read-only analysis.
- **Current trust:** `LIVE_STATE_TRUST = INVALID` until the §4 recovery is approved, executed by a human, and independently reconciled.
- **Scope guard for this phase:** no PM2 restart/resurrect/update/kill, no service resurrection, no process kill, no secret rotation, no DB mutation, no recovery execution. All of the above is deferred to the §4 live-action request pending human approval.
