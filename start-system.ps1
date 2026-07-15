# =====================================================================
#  HYDI / Heidi - Autonomous Launcher & Watchdog
#
#  Starts WorkerOrchestrator.js and launch-heidi-mobile.js, logs their
#  output to .\logs\, and supervises them INDEPENDENTLY - each process is
#  restarted only when IT crashes, so a WorkerOrchestrator crash never bounces
#  the chat server. Frees port 3006 only when (re)starting launch-heidi-mobile.
#
#  Run manually:   powershell -ExecutionPolicy Bypass -File start-system.ps1
#  Run hidden:     see setup-autostart.ps1 (registers this at logon)
#
#  Stop it:        Stop-ScheduledTask -TaskName "HeidiSystem"
#                  (or just close the hidden powershell.exe process)
# =====================================================================

function Stamp {
    "[{0}]" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

# Prevent duplicate watchdog instances from fighting over ports.
# NOTE: Stamp must be defined ABOVE this block - if it isn't, the Write-Host
# below throws CommandNotFound, which the catch swallows and then starts a
# SECOND watchdog, defeating the lock entirely.
try {
    $null = [System.Threading.Mutex]::OpenExisting("Global\HEIDI_SYSTEM_LOCK")
    Write-Host "$(Stamp) HEIDI watchdog already running - exiting"
    exit 0
} catch {
    $mutex = New-Object System.Threading.Mutex($true, "Global\HEIDI_SYSTEM_LOCK")
}

$root   = "C:\Users\Owner\HYDI-System-v2"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Free-Port {
    param([int]$Port)
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess -gt 0) {
            try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}

function Start-Worker {
    Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Starting WorkerOrchestrator.js"
    return Start-Process -FilePath "node" `
        -ArgumentList "workers\WorkerOrchestrator.js" `
        -WorkingDirectory $root `
        -RedirectStandardOutput (Join-Path $logDir "workers.log") `
        -RedirectStandardError  (Join-Path $logDir "workers.err.log") `
        -WindowStyle Hidden -PassThru
}

function Start-Heidi {
    # The chat server owns port 3006 - free it only when (re)starting THIS process.
    Free-Port -Port 3006
    Start-Sleep -Seconds 1
    Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Starting launch-heidi-mobile.js"
    return Start-Process -FilePath "node" `
        -ArgumentList "launch-heidi-mobile.js" `
        -WorkingDirectory $root `
        -RedirectStandardOutput (Join-Path $logDir "heidi.log") `
        -RedirectStandardError  (Join-Path $logDir "heidi.err.log") `
        -WindowStyle Hidden -PassThru
}

function Start-HeidiCore {
    # heidi-core owns port 3458 - free it only when (re)starting THIS process.
    Free-Port -Port 3458
    Start-Sleep -Seconds 1
    Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Starting heidi-core\index-clean-3458.js"
    return Start-Process -FilePath "node" `
        -ArgumentList "heidi-core\index-clean-3458.js" `
        -WorkingDirectory $root `
        -RedirectStandardOutput (Join-Path $logDir "heidi-core.log") `
        -RedirectStandardError  (Join-Path $logDir "heidi-core.err.log") `
        -WindowStyle Hidden -PassThru
}

Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Launcher starting..."

# Restart counters + state file for the status endpoint
$stateFile = Join-Path $root "watchdog-state.json"

# --- Reap orphaned worker/chat left by a previous (now-dead) watchdog ---
# When a watchdog is replaced, Windows orphans its child node processes instead of
# killing them, so a stale worker can keep running pre-update code (spamming logs and
# holding DB connections). Read the PIDs the previous watchdog recorded and terminate
# any still alive before we spawn fresh ones. We only touch PIDs we ourselves recorded,
# and only if they're still 'node', to avoid hitting a reused PID. This runs only after
# we hold the lock, so by definition no live watchdog owns these children.
if (Test-Path $stateFile) {
    try {
        $prev = Get-Content $stateFile -Raw | ConvertFrom-Json
        foreach ($stalePid in @($prev.worker_pid, $prev.chat_pid, $prev.core_pid)) {
            if ($stalePid) {
                $p = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
                if ($p -and $p.ProcessName -eq 'node') {
                    try {
                        Stop-Process -Id $stalePid -Force -ErrorAction Stop
                        Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Reaped orphaned node PID $stalePid from a previous watchdog"
                    } catch {}
                }
            }
        }
    } catch {
        Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Reap step skipped: $($_.Exception.Message)"
    }
}

$workerRestarts = 0
$chatRestarts   = 0
$coreRestarts   = 0
$launchTime     = Get-Date -Format "o"

function Update-State {
    $state = @{
        worker_restarts = $workerRestarts
        chat_restarts   = $chatRestarts
        core_restarts   = $coreRestarts
        last_restart    = Get-Date -Format "o"
        launch_time     = $launchTime
        watchdog_pid    = $PID
        worker_pid      = if ($workerProc) { $workerProc.Id } else { $null }
        chat_pid        = if ($heidiProc)  { $heidiProc.Id }  else { $null }
        core_pid        = if ($coreProc)   { $coreProc.Id }   else { $null }
    } | ConvertTo-Json -Depth 3
    $state | Out-File -FilePath $stateFile -Encoding utf8 -Force
}

Update-State

# Start both once, then supervise them INDEPENDENTLY so a crash in one never
# restarts the other. This keeps the chat server (3006) stable even when
# WorkerOrchestrator.js crash-loops.
$workerProc = Start-Worker
$heidiProc  = Start-Heidi
$coreProc   = Start-HeidiCore
Update-State   # record the freshly-started worker/chat/core PIDs so the next watchdog can reap them

while ($true) {
    try {
        Start-Sleep -Seconds 5

        # Safely check HasExited - the process handle can become invalid
        # after a very fast crash, which would throw and kill this script.
        $workerExited = $false
        try {
            if ($workerProc -and $workerProc.Id) {
                $workerExited = $workerProc.HasExited
            }
        } catch {
            $workerExited = $true
        }

        $heidiExited = $false
        try {
            if ($heidiProc -and $heidiProc.Id) {
                $heidiExited = $heidiProc.HasExited
            }
        } catch {
            $heidiExited = $true
        }

        $coreExited = $false
        try {
            if ($coreProc -and $coreProc.Id) {
                $coreExited = $coreProc.HasExited
            }
        } catch {
            $coreExited = $true
        }

        if ($workerExited) {
            $workerRestarts++
            Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) WorkerOrchestrator.js exited - restarting it in 5s (restart #$workerRestarts)"
            Update-State
            Start-Sleep -Seconds 5
            $workerProc = Start-Worker
        }

        if ($heidiExited) {
            $chatRestarts++
            Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) launch-heidi-mobile.js exited - restarting it in 5s (restart #$chatRestarts)"
            Update-State
            Start-Sleep -Seconds 5
            $heidiProc = Start-Heidi
        }

        if ($coreExited) {
            $coreRestarts++
            Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) heidi-core\index-clean-3458.js exited - restarting it in 5s (restart #$coreRestarts)"
            Update-State
            Start-Sleep -Seconds 5
            $coreProc = Start-HeidiCore
        }
    } catch {
        Add-Content -Path (Join-Path $logDir "launcher.log") -Value "$(Stamp) Watchdog loop error: $($_.Exception.Message) - continuing..."
        Start-Sleep -Seconds 5
    }
}
