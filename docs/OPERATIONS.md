# HYDI Operations Runbook (Frank)

Daily operation of the PM2-supervised HYDI stack. PM2 is the only process
manager — see `docs/runbooks/windows-autostart.md` for boot setup.

## Daily start / stop

```powershell
# Start everything (idempotent — safe to run twice)
powershell -File C:\Users\Owner\HYDI-System-v2\start-heidi-everything.ps1

# Stop everything
pm2 stop all

# Status
pm2 status
node C:\Users\Owner\HYDI-System-v2\scripts\hydi-verify.js
```

## Logs

```powershell
pm2 logs heidi-core --lines 100     # Heidi Core (:3459)
pm2 logs heidi-web-standalone      # web (:3000)
pm2 logs ursula-local              # Ursula (:3100)
pm2 logs frank-observer             # read-only observer
# Raw files: C:\Users\Owner\.pm2\logs\<app>-out.log / -error.log
```

## Health checks

```powershell
node scripts\check-port-registry.js     # declared ports vs .ports.json
powershell -File scripts\frank\port-doctor.ps1   # who holds each port
node scripts\hydi-verify.js             # full PASS/FAIL table
```

## Pausing Heidi

Three levels, all reversible:

1. **Ops agent** (repairs): chat command or ops-control —
   `ops agent pause` / `ops agent resume` via heidi-core, or
   `ops_control.paused=1` in the ops store.
2. **Heidi agent** (agent_bus decisions): set `HEIDI_PAUSE=true` in env and
   `pm2 restart heidi-agent --update-env`. A `paused` flag on
   `heidi_decision_bounds` is also honored when the column exists.
3. **Everything**: `pm2 stop heidi-agent heidi-core` — observe-only surfaces
   (frank-observer) keep running; they are read-only by design.

Paused Heidi still observes; it never executes.

## Approving actions

- **Missions** (heidi-core): `awaiting_approval` missions are decided via
  the mission routes (`POST /missions/:id/decision`) or chat `task`
  commands — approvals require the service token / device auth.
- **agent_bus tasks** (heidi-agent): verdicts land as REVIEW in
  `agent_bus.status`; approval flow is the Ursula queue (Phase 8).
- **Direct chat actions**: disabled by default (`HEIDI_CHAT_DIRECT_ACTIONS`).

## Rotating secrets

Secrets live in `.env.local` (gitignored) — never commit them.

```powershell
# Example: rotate HYDI_SERVICE_SECRET
# 1. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 2. Update .env.local
# 3. pm2 restart all --update-env
# 4. Update any external consumer (phone scripts, Ursula env) to match.
```

## Restoring from backup

- **Code**: `git fetch && git checkout clean-main && git pull` in
  `C:\Users\Owner\HYDI-System-v2`.
- **Web build**: `.next-prev` holds the last-good build; swap per
  `frank-auto-deploy` procedure.
- **PM2 list**: `pm2 resurrect` restores `~\.pm2\dump.pm2` (saved via
  `pm2 save` after any intentional `pm2 delete/start` change).
- **DB**: local Supabase data lives in Docker volumes — see
  `supabase/` docs; do NOT drop schemas.

## Adding a division

```powershell
# 1. Apply migrations if needed (supabase db push / migration runner)
# 2. Seed (idempotent — safe to re-run):
node scripts\seed-divisions.js --dry-run   # preview
node scripts\seed-divisions.js             # apply
# 3. Edit notes/status in Supabase or via script; seed never clobbers them.
```

## Adding an app workspace (Ursula)

Workspaces are config-driven (`apps/ursula-frontend` portfolio config).
Each entry needs: repo path, branch, health URL, and a seeded **test**
account — never real user credentials.

## When something is down

1. `pm2 status` — errored/stopped apps.
2. `pm2 logs <app> --err --lines 50`.
3. `node scripts\hydi-verify.js` — which checks fail.
4. `powershell -File scripts\frank\port-doctor.ps1` — port conflicts.
5. `pm2 restart <app>` — PM2 has restart limits; a crash-looping app
   surfaces as `errored` rather than spinning.
