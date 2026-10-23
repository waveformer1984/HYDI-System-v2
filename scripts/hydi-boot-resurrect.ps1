#Requires -Version 5.1
<#
.SYNOPSIS
  HYDI boot resurrection: wait for Docker + local Supabase Postgres,
  then `pm2 resurrect` the saved process list.

  Registered as the "PM2Resurrect" Scheduled Task (logon trigger).
  Idempotent - safe to run manually anytime.

  Waits (bounded):
    1. Docker daemon answers `docker version`           (<= 6 min)
    2. Postgres answers TCP on 127.0.0.1:54322          (<= 6 min)
    3. Best-effort: start exited supabase containers     (edge_runtime etc.)
    4. pm2 resurrect
#>

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir   = Join-Path $env:USERPROFILE '.hydi\logs'
$LogFile  = Join-Path $LogDir 'boot-resurrect.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line
  Write-Output $line
}

function Wait-For([scriptblock]$Probe, [string]$What, [int]$TimeoutSec = 360) {
  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
    if (& $Probe) { Log "$What ready after $([int]((Get-Date) - $start).TotalSeconds)s"; return $true }
    Start-Sleep -Seconds 5
  }
  Log "TIMEOUT waiting for $What after ${TimeoutSec}s -- continuing anyway (fail-open: pm2 will restart crashed services)"
  return $false
}

Log '=== HYDI boot resurrect starting ==='

# 1. Docker daemon
$dockerReady = Wait-For { cmd /c "docker info 2>nul" | Out-Null; $LASTEXITCODE -eq 0 } 'Docker daemon' 360

# 2. Supabase Postgres on 54322
if ($dockerReady) {
  Wait-For {
    try {
      $c = New-Object Net.Sockets.TcpClient
      $c.Connect('127.0.0.1', 54322)
      $c.Close()
      $true
    } catch { $false }
  } 'Postgres :54322' 360
}

# 3. Best-effort: revive stopped supabase service containers for this project
if ($dockerReady) {
  $project = Split-Path -Leaf $RepoRoot
  $exited = docker ps -a --filter "name=supabase_" --filter "name=$project" --filter "status=exited" --format '{{.Names}}' 2>$null
  foreach ($name in @($exited)) {
    Log "starting exited supabase container: $name"
    docker start $name 2>&1 | Out-Null
  }
}

# 4. Resurrect the saved PM2 process list
Log 'running pm2 resurrect'
Push-Location $RepoRoot
try {
  pm2 resurrect 2>&1 | ForEach-Object { Log $_ }
  Log 'pm2 resurrect finished'
} catch {
  Log "pm2 resurrect FAILED: $_"
} finally {
  Pop-Location
}
Log '=== HYDI boot resurrect done ==='
