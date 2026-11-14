#requires -RunAsAdministrator
<#
.SYNOPSIS
  Reclaim C: space from the Docker Desktop WSL2 virtual disk (docker_data.vhdx).

.DESCRIPTION
  Jordan-run, elevated, AFTER a reboot (pagefile must be shrunk first).

  Order of operations:
    1. Print C: free space (before).
    2. Best-effort fstrim inside the docker-desktop WSL distro so deleted
       blocks are discarded and become compactable. Tolerated if fstrim
       is unavailable - compact still runs.
    3. Record running containers, then `docker stop -t 60` them gracefully
       (supabase_db last so Postgres checkpoints cleanly).
    4. Quit Docker Desktop, then `wsl --shutdown`.
    5. diskpart: attach docker_data.vhdx readonly, compact vdisk, detach.
    6. Relaunch Docker Desktop, wait for the engine, `docker start` the
       recorded container list (db first - containers stopped by hand do
       NOT auto-start under restart=unless-stopped), then verify
       supabase_kong and supabase_db are healthy.
    7. Print C: free space (after).

  SAFETY:
    - Aborts immediately if not elevated.
    - NEVER runs `docker volume prune`, `docker system prune --volumes`,
      or touches any Docker volume. Only the .vhdx file is compacted.
    - All Docker/WSL state changes are reversible: Docker Desktop is
      relaunched and containers use restart=unless-stopped.

.NOTES
  Expected gain: docker_data.vhdx is ~31 GB while `docker system df`
  accounts for ~18 GB - roughly 13 GB of freed-but-untrimmed blocks.
#>

[CmdletBinding()]
param(
  [string]$VhdxPath = 'C:\Users\Owner\AppData\Local\Docker\wsl\disk\docker_data.vhdx',
  [int]$EngineTimeoutSec = 300
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  XX  $msg" -ForegroundColor Red }

# --- 0. Elevation gate -------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Fail 'This script must run elevated. Right-click PowerShell -> Run as administrator, then:'
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit 2
}

function Get-CFreeGB {
  [math]::Round((Get-PSDrive C).Free / 1GB, 2)
}

$freeBefore = Get-CFreeGB
Write-Step "C: free BEFORE: $freeBefore GB"
if (-not (Test-Path -LiteralPath $VhdxPath)) {
  Write-Fail "vhdx not found at $VhdxPath - check Docker Desktop's disk image location."
  exit 3
}
$vhdxGB = [math]::Round((Get-Item -LiteralPath $VhdxPath).Length / 1GB, 2)
Write-Host "  vhdx size: $vhdxGB GB"

# --- 1. fstrim inside docker-desktop (best effort) ----------------------------
Write-Step 'Discarding freed blocks inside docker-desktop (fstrim)'
try {
  $fstrim = wsl -d docker-desktop -e fstrim -av 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Ok 'fstrim completed' ; $fstrim | Select-Object -Last 3 }
  else { Write-Warn "fstrim unavailable or failed (exit $LASTEXITCODE) - continuing; compact may reclaim less" }
} catch {
  Write-Warn "fstrim threw: $($_.Exception.Message) - continuing"
}

# --- 2. Gracefully stop running containers (db last) ---------------------------
Write-Step 'Recording and gracefully stopping containers'
$running = @(docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match '\S' })
if ($running.Count -eq 0) {
  Write-Warn 'no running containers - engine may already be down; continuing'
} else {
  Write-Host ("  running: " + ($running -join ', '))
  $dbNames   = @($running | Where-Object { $_ -match 'supabase_db|postgres' })
  $otherNames = @($running | Where-Object { $_ -notmatch 'supabase_db|postgres' })
  # Non-db containers first so Postgres gets the last clean shutdown window.
  if ($otherNames.Count -gt 0) { docker stop -t 60 $otherNames | Out-Null }
  if ($dbNames.Count -gt 0)   { docker stop -t 60 $dbNames   | Out-Null }
  Write-Ok "stopped $($running.Count) container(s) gracefully (db last)"
}
$script:stoppedContainers = $running

# --- 3. Quit Docker Desktop ----------------------------------------------------
Write-Step 'Stopping Docker Desktop processes'
$dockerProcs = Get-Process -Name 'Docker Desktop','com.docker.backend' -ErrorAction SilentlyContinue
if ($dockerProcs) {
  $dockerProcs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
  Write-Ok 'Docker Desktop processes stopped'
} else {
  Write-Warn 'no Docker Desktop processes found - already stopped?'
}

# --- 4. wsl --shutdown ---------------------------------------------------------
Write-Step 'wsl --shutdown'
wsl --shutdown
Start-Sleep -Seconds 5
# wsl.exe emits UTF-16 on Windows; Select-String never matches unless we ask
# for UTF-8 or strip NULs. Use --running (names only) + NUL strip, belt and
# suspenders, and abort before diskpart if docker-desktop is still listed.
$env:WSL_UTF8 = '1'
$wslRunning = ((wsl -l --running 2>$null) | Out-String) -replace "`0", ''
if ($wslRunning -match 'docker-desktop') {
  Write-Fail 'docker-desktop distro still running - aborting before compact.'
  exit 4
}
Write-Ok 'all WSL distros stopped'

# --- 4. diskpart compact -------------------------------------------------------
Write-Step "Compacting $VhdxPath"
$dpScript = Join-Path $env:TEMP "hydi-compact-$PID.txt"
@"
select vdisk file="$VhdxPath"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@ | Set-Content -LiteralPath $dpScript -Encoding ASCII

$dpOut = diskpart /s $dpScript 2>&1 | Out-String
Remove-Item -LiteralPath $dpScript -Force -ErrorAction SilentlyContinue
Write-Host $dpOut
if ($dpOut -match 'compact vdisk.*(error|failed|cannot)') {
  Write-Fail 'diskpart compact reported an error - see output above.'
  exit 5
}
$vhdxAfter = [math]::Round((Get-Item -LiteralPath $VhdxPath).Length / 1GB, 2)
Write-Ok "vhdx now $vhdxAfter GB (was $vhdxGB GB)"

# --- 5. Relaunch Docker Desktop ------------------------------------------------
Write-Step 'Relaunching Docker Desktop'
$ddExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (Test-Path -LiteralPath $ddExe) {
  Start-Process -LiteralPath $ddExe
} else {
  Write-Fail "Docker Desktop.exe not found at $ddExe - start it manually, then re-run verification only."
  exit 6
}

Write-Host "  waiting up to $EngineTimeoutSec s for engine..."
$deadline = (Get-Date).AddSeconds($EngineTimeoutSec)
$engineUp = $false
while ((Get-Date) -lt $deadline) {
  docker version --format '{{.Server.Version}}' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $engineUp = $true; break }
  Start-Sleep -Seconds 10
}
if (-not $engineUp) {
  Write-Fail "Docker engine did not come up within $EngineTimeoutSec s."
  Write-Warn 'Check Docker Desktop UI; once running, verify with: docker ps'
  exit 7
}
Write-Ok 'docker engine responding'

# --- 6. Restart the containers we stopped (db first) -----------------------------
# Containers stopped via `docker stop` do NOT auto-start under
# restart=unless-stopped - start the recorded list explicitly.
Write-Step 'Restarting recorded containers (db first)'
if ($script:stoppedContainers -and $script:stoppedContainers.Count -gt 0) {
  $dbStart   = @($script:stoppedContainers | Where-Object { $_ -match 'supabase_db|postgres' })
  $restStart = @($script:stoppedContainers | Where-Object { $_ -notmatch 'supabase_db|postgres' })
  if ($dbStart.Count -gt 0)   { docker start $dbStart   | Out-Null }
  Start-Sleep -Seconds 10    # give Postgres a head start before dependents
  if ($restStart.Count -gt 0) { docker start $restStart | Out-Null }
  Write-Ok "started $($script:stoppedContainers.Count) container(s)"
} else {
  Write-Warn 'no recorded container list - if services are down, run: docker ps -a then docker start <name>'
}

# --- 7. Verify supabase_kong + supabase_db healthy ------------------------------
Write-Step 'Verifying supabase_kong + supabase_db'
$deadline = (Get-Date).AddMinutes(5)
do {
  Start-Sleep -Seconds 15
  $status = docker ps --format '{{.Names}} {{.Status}}' 2>$null
  $kong = ($status | Select-String 'supabase_kong') -join ' '
  $db   = ($status | Select-String 'supabase_db_HYDI-System-v2') -join ' '
} while ((-not ($kong -match 'healthy') -or -not ($db -match 'healthy')) -and (Get-Date) -lt $deadline)

Write-Host "  kong: $kong"
Write-Host "  db:   $db"
if ($kong -match 'healthy' -and $db -match 'healthy') {
  Write-Ok 'kong and db both healthy'
} else {
  Write-Warn 'containers still starting or unhealthy - check: docker ps -a'
}

# --- 8. Report ------------------------------------------------------------------
$freeAfter = Get-CFreeGB
Write-Step 'DONE'
Write-Host "  C: free BEFORE: $freeBefore GB"
Write-Host "  C: free AFTER:  $freeAfter GB"
Write-Host "  reclaimed:      $([math]::Round($freeAfter - $freeBefore, 2)) GB"
Write-Host "  Paste this whole output back to the agent."
