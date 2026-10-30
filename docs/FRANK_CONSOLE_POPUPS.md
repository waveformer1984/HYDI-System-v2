# Console windows popping up on Frank

## What was happening

Terminal windows kept appearing on Frank's desktop and taking focus: Node,
`cmd`, PowerShell and an occasional "ollama serve". It got in the way of using
the PC, and of remote control too, because clicks and typing went to whatever
window had just appeared. Most were empty or showed
`[process exited with code 1] … press Enter to restart`, and they piled up.

Observed on 2026-10-30 by watching the desktop over remote control:
- a new Node window printed
  `watchdog started (mode=once, interval=30000ms, webhook=off)`;
- seconds later a `cmd` window showed `[process exited with code 1]`;
- a stack of about six such windows sat on the main display.

## Why it happens

On Windows, a console program (`node`, `git`, `gh`, `powershell`, and
`cmd.exe` when a command runs through a shell) started from a background
process opens its own console window unless it is started hidden: Node's
`windowsHide: true`, or a task that does not run on the desktop.

Frank's default console is Windows Terminal. It shows each such window, gives
it focus, and keeps it open when the program exits with an error, so the
windows pile up.

## Causes found, and fixed in this change

| Source | How often | Fix |
|---|---|---|
| Scheduled task **HYDI-Watchdog** (`scripts/install-watchdog.ps1`) runs `node scripts\watchdog.js --once` as a per-user task on the desktop | every 2 minutes | Task retired. PM2's `hydi-watchdog` already runs the same script continuously and hidden. `install-watchdog.ps1` now removes the task, and `disable-stale-tasks.bat` deletes it |
| **hydi-local-ci** (PM2) launched `cmd` (npm/npx), `git` and `gh` without `windowsHide` | every test pass (on each PR/commit, checking every 10 min) | `windowsHide: true` on all four launches |
| **heidi-core** brain watchdog runs `ollama serve` through a shell, detached, without `windowsHide` | every 90 s while Ollama is down | `windowsHide: true` |
| **protoforge-opportunity-scheduler** `taskkill` on child cleanup | when it kills a child | `windowsHide: true` |

**Guard:** `tests/unit/no-console-popups.test.js` reads `ecosystem.config.js`.
For every script PM2 runs, plus `lib/observation`, `lib/storage` and
`lib/runtime`, it fails if any `child_process` launch is missing
`windowsHide`. It failed on the original `local-ci.js`.

## On Frank (after this merges)

1. Remove the scheduled task. It's a per-user task, so this needs no admin
   rights:
   ```powershell
   schtasks /Delete /TN "HYDI-Watchdog" /F
   ```
2. Restart the changed apps so they run the new code:
   ```powershell
   pm2 restart hydi-local-ci heidi-core hydi-protoforge-scout
   ```
3. Close the windows that have already piled up. They're dead terminals;
   closing them stops nothing that's running.
4. If windows still appear, find out what starts them. Both commands below
   only read:
   ```powershell
   # Enabled scheduled tasks that repeat, with what they run:
   Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' -and $_.Triggers.Repetition.Interval } |
     ForEach-Object { [pscustomobject]@{ Task = $_.TaskPath + $_.TaskName; Every = $_.Triggers[0].Repetition.Interval;
       Runs = ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' | ' } } | Format-Table -Wrap

   # Console processes started in the last 10 minutes, and who started them:
   Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe' OR Name='powershell.exe' OR Name='conhost.exe' OR Name='wsl.exe'" |
     Where-Object { $_.CreationDate -gt (Get-Date).AddMinutes(-10) } |
     ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)";
       [pscustomobject]@{ Started = $_.CreationDate; Name = $_.Name; Cmd = $_.CommandLine; Parent = "$($p.Name) $($p.CommandLine)" } } |
     Sort-Object Started | Format-Table -Wrap
   ```
   Older HYDI tasks such as "HYDI Health Monitor" (PowerShell every 5 minutes)
   are listed as disabled in `scripts/disable-stale-tasks.bat`. The first
   command confirms whether that is still true.

## Optional

Windows Terminal: **Settings → Defaults → Advanced → Profile termination
behavior → "Close when process exits"** makes failed console windows close
instead of waiting for Enter. This changes how all terminals behave, so it's
a personal choice. The fixes above don't depend on it.
