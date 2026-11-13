# hydi-boot-resurrect.ps1 — governed PM2 resurrect for the PM2Resurrect scheduled task.
# Single boot path on Frank: this script is the only thing \PM2Resurrect runs.
# Order: wait for Docker + local Supabase Postgres (apps depend on them),
# then pm2 resurrect, then verify the daemon answers and apps came up.
# Idempotent: safe to run when PM2 is already up (resurrect is a no-op merge).

$ErrorActionPreference = 'Continue'
$LogDir = 'C:\Users\Owner\HYDI-System-v2\logs'
$LogFile = Join-Path $LogDir 'hydi-boot-resurrect.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line
  Write-Output $line
}

function Test-Port([int]$port, [int]$timeoutMs = 2000) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($timeoutMs)
    if ($ok) { $c.EndConnect($iar) }
    $c.Close()
    return [bool]$ok
  } catch { return $false }
}

Log '=== hydi-boot-resurrect start ==='

# 1. Wait for Docker daemon (bounded, single probe at a time).
$dockerDeadline = (Get-Date).AddMinutes(5)
$dockerUp = $false
while ((Get-Date) -lt $dockerDeadline) {
  $info = & docker info --format '{{.ServerVersion}}' 2>$null
  if ($LASTEXITCODE -eq 0 -and $info) { $dockerUp = $true; break }
  Log 'docker daemon not ready, retrying in 10s'
  Start-Sleep -Seconds 10
}
Log ("docker daemon: " + $(if ($dockerUp) { 'up' } else { 'TIMEOUT after 5m — continuing anyway' }))

# 2. Wait for local Supabase Postgres (kong :54321 is the API surface; db :54322 direct).
$dbDeadline = (Get-Date).AddMinutes(3)
$dbUp = $false
while ((Get-Date) -lt $dbDeadline) {
  if ((Test-Port 54322) -or (Test-Port 54321)) { $dbUp = $true; break }
  Start-Sleep -Seconds 10
}
Log ("supabase postgres/kong: " + $(if ($dbUp) { 'reachable' } else { 'TIMEOUT after 3m — continuing anyway' }))

# 3. Resurrect the PM2 fleet from dump.pm2.
Log 'running pm2 resurrect'
& pm2 resurrect 2>&1 | ForEach-Object { Log ("pm2: " + $_) }

# 3b. Kong gate — heidi-web's init blocks on Supabase REST; a dead Kong
#     leaves /heidi answering 000 for minutes (observed 2026-11-12). TCP
#     connect is not enough — probe the REST root for a real HTTP response,
#     and if the container is down, start it and wait (bounded).
function Test-KongRest {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:54321/rest/v1/' -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -lt 500)
  } catch {
    # Any HTTP response (even 401/404) proves Kong+upstream are alive.
    return ($_.Exception.Response -ne $null)
  }
}
$kongDeadline = (Get-Date).AddMinutes(3)
$kongOk = $false
while ((Get-Date) -lt $kongDeadline) {
  if (Test-KongRest) { $kongOk = $true; break }
  $cs = (& docker inspect -f '{{.State.Status}}' supabase_kong_HYDI-System-v2 2>$null)
  if ($cs -ne 'running') {
    Log "kong container status=$cs — attempting docker start"
    & docker start supabase_kong_HYDI-System-v2 2>&1 | ForEach-Object { Log "docker start kong: $_" }
  }
  Start-Sleep -Seconds 10
}
Log ("kong REST gate: " + $(if ($kongOk) { 'healthy' } else { 'TIMEOUT after 3m — heidi-web may stall on init' }))

# 4. Persist current process list so future resurrects match reality.
& pm2 save 2>&1 | ForEach-Object { Log ("pm2 save: " + $_) }

# 5. Verify daemon answers.
$ping = & pm2 ping 2>&1 | Out-String
Log ("pm2 ping: " + $ping.Trim())

# 6. Brief app census (names + status only; jlist can be slow on this host —
#    it shells out to WMI per app, so allow up to ~60s across two attempts).
$census = $null
foreach ($attempt in 1..2) {
  try {
    $job = Start-Job -ScriptBlock { & pm2 jlist 2>$null }
    if (Wait-Job $job -Timeout 45) { $census = Receive-Job $job }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($census) { break }
  } catch { }
  Log "app census attempt $attempt produced nothing, retrying"
  Start-Sleep -Seconds 10
}
try {
  $apps = $census | ConvertFrom-Json
  $online = @($apps | Where-Object { $_.pm2_env.status -eq 'online' }).Count
  $total = @($apps).Count
  Log ("apps: $online/$total online")
} catch {
  Log 'app census failed (jlist error) — check pm2 logs manually'
}

Log '=== hydi-boot-resurrect done ==='
