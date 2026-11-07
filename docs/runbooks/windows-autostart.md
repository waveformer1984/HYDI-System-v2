# Runbook: Windows autostart for the HYDI stack (Frank)

Goal: after a reboot, the PM2 fleet comes up without anyone logging in
interactively, and `pm2 save` reflects the intended process list.

PM2 is the only process manager. Nothing else should auto-launch HYDI
services (the old `start-heidi-everything.ps1` direct-spawn behavior was
removed in Phase 2 — the script is now a PM2 wrapper you can also run
manually).

## One-time setup (admin PowerShell)

```powershell
# 1. Install the PM2 boot hook (prints the command to run, then run it)
pm2 startup
#    -> it prints a single line like:
#       sc.exe create pm2-owner ... bin\pm2 resurrect
#    Run that printed command (needs admin).

# 2. Save the current intended process list
cd C:\Users\Owner\HYDI-System-v2
pm2 save
```

After this, Windows starts the PM2 daemon at boot and `pm2 resurrect`
restores every app in `~\.pm2\dump.pm2`.

## Verify after a reboot

```powershell
pm2 status                      # all apps online (heidi-mobile-chat needs HEIDI_MOBILE_TOKEN - see below)
node C:\Users\Owner\HYDI-System-v2\scripts\check-port-registry.js
powershell -File C:\Users\Owner\HYDI-System-v2\scripts\frank\port-doctor.ps1
```

Expected listeners: 3000, 3001, 3005, 3100, 3459, 11434, 54321.
Closed by design: 3006 (until the mobile token is set), 5050 (heidi-bridge
is external and not running), 3461 (advisory off).

## heidi-mobile-chat (:3006) — token-gated

`launch-heidi-mobile.js` exits 78 without `HEIDI_MOBILE_TOKEN`
(`HEIDI_MOBILE_REQUIRE_TOKEN=1` in the PM2 env). The previous token was
lost with the old PM2 daemon and is NOT recoverable — regenerating it
breaks Jordan's existing phone pairing. To re-enable:

```powershell
$env:HEIDI_MOBILE_TOKEN = '<token>'   # or restore from your password manager
pm2 restart heidi-mobile-chat --update-env
pm2 save
```

Then re-pair the phone at the mobile chat URL (`/api/pair`).

## heidi-bridge (:5050) — outside PM2

The Flask bridge lives at `C:\ProtoForge_Ecosystem\heidi-bridge.py` and is
not in `ecosystem.config.js`. If it is needed at boot, add a Task
Scheduler entry (At log on, user Owner):

```powershell
$action  = New-ScheduledTaskAction -Execute 'python' -Argument 'heidi-bridge.py' -WorkingDirectory 'C:\ProtoForge_Ecosystem'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName 'HYDI-HeidiBridge' -Action $action -Trigger $trigger
```

Or leave it off — nothing in the PM2 fleet depends on it today.

## If PM2 resurrect restores stale apps

`pm2 delete <name>` for anything not in `ecosystem.config.js`, then
`pm2 save`. `npm run runtime:audit` flags UNDECLARED processes.
