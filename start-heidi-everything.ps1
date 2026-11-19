<#
.SYNOPSIS
  start-heidi-everything.ps1 - bring the whole HYDI stack up via PM2.
.DESCRIPTION
  Phase 2: PM2 is the ONLY process manager on Frank. This script no longer
  launches services itself - it is a thin wrapper:

    preflight (node / pm2 / repo / env present)
      -> pm2 resurrect        (restore the saved process list, if any)
      -> pm2 start ecosystem.config.js   (fill gaps; idempotent)
      -> health probe         (key service ports from .ports.json)
      -> summary

  Running it twice changes nothing. Individual services are managed with
  pm2 (restart/stop/logs), never by this script.

  The old version spawned heidi-core/mobile/bridge/frontend directly,
  which fought PM2 for the same ports. That behavior is gone.

  heidi-bridge (:5050) lives OUTSIDE this repo at C:\ProtoForge_Ecosystem
  and is not PM2-managed - if it is needed, start it separately (see
  docs/runbooks/windows-autostart.md).

.PARAMETER SkipFrontend
  Deprecated/no-op kept for shortcut compatibility. PM2 decides what runs.

.PARAMETER AgentOnly
  Start only the PM2 app `heidi-agent` (Phase 2 persistent loop, health :3462).
  Does not resurrect or start the full fleet — use for agent-only bring-up tests.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File start-heidi-everything.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File start-heidi-everything.ps1 -AgentOnly
#>
param(
    [switch]$SkipFrontend,   # deprecated: accepted for compatibility, ignored
    [switch]$AgentOnly
)

$Root     = "C:\Users\Owner\HYDI-System-v2"
$LogDir   = "C:\Users\Owner\hydi-logs"
$Ecosystem = Join-Path $Root "ecosystem.config.js"

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$BootLog = Join-Path $LogDir ("pm2-boot-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Log {
    param([string]$Msg, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Msg
    $color = switch ($Level) { "OK" { "Green" } "WARN" { "Yellow" } "FAIL" { "Red" } default { "Gray" } }
    Write-Host $line -ForegroundColor $color
    Add-Content -Path $BootLog -Value $line
}

function Test-AgentHealth3462 {
    param([int]$TimeoutSec = 5)
    try {
        $uri = "http://127.0.0.1:3462/health"
        $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
            Log "heidi-agent GET $uri OK" "OK"
            return $true
        }
        Log "heidi-agent health HTTP $($resp.StatusCode)" "WARN"
        return $false
    } catch {
        Log "heidi-agent health probe failed: $($_.Exception.Message)" "WARN"
        return $false
    }
}

# ---------------- preflight ----------------
$fail = $false
foreach ($tool in @('node', 'pm2')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Log "required tool missing: $tool" "FAIL"; $fail = $true
    }
}
if (-not (Test-Path -LiteralPath $Ecosystem)) { Log "ecosystem.config.js missing at $Root" "FAIL"; $fail = $true }
if (-not (Test-Path -LiteralPath (Join-Path $Root '.env.local'))) { Log ".env.local missing - services will lack Supabase creds" "WARN" }
if ($fail) { Log "preflight failed - nothing started" "FAIL"; exit 1 }
Log "preflight OK (node $(node --version), pm2 present)"

# ---------------- bring the fleet up ----------------
Push-Location $Root
try {
    if ($AgentOnly) {
        Log "AgentOnly: starting PM2 app heidi-agent only" "INFO"
        & pm2 start $Ecosystem --only heidi-agent 2>&1 | ForEach-Object { Log "pm2 start: $_" }
    } else {
        # Restore whatever PM2 had saved (post-reboot path). Failure is fine on
        # first boot - the ecosystem start below covers it.
        & pm2 resurrect 2>&1 | ForEach-Object { Log "resurrect: $_" }
        & pm2 start $Ecosystem 2>&1 | ForEach-Object { Log "pm2 start: $_" }
    }
} finally { Pop-Location }

# ---------------- settle + health probe ----------------
Start-Sleep -Seconds 10

if ($AgentOnly) {
    $agentOk = Test-AgentHealth3462
    & pm2 list 2>&1 | ForEach-Object { Log "pm2: $_" }
    if (-not $agentOk) {
        Log "heidi-agent :3462 health not reachable — see pm2 logs heidi-agent" "WARN"
        exit 1
    }
    Log "AgentOnly done (HEIDI_ALLOW_EXEC remains off in ecosystem)" "OK"
    exit 0
}

# Key user-facing ports from .ports.json (registry is the source of truth).
$probePorts = @(
    @{ port = 3000;  name = 'heidi-web' },
    @{ port = 3459;  name = 'heidi-core' },
    @{ port = 3100;  name = 'ursula-local' },
    @{ port = 11434; name = 'ollama' },
    @{ port = 3006;  name = 'heidi-mobile-chat' },
    @{ port = 3005;  name = 'protoforge-core (boot child)' },
    @{ port = 3462;  name = 'heidi-agent-loop health' }
)

$ok = 0; $down = @()
foreach ($p in $probePorts) {
    $open = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $p.port, $null, $null)
        $open = $iar.AsyncWaitHandle.WaitOne(2000) -and $c.Connected
        $c.Close()
    } catch {}
    if ($open) { $ok++; Log ("{0} :{1} listening" -f $p.name, $p.port) "OK" }
    else { $down += $p; Log ("{0} :{1} NOT listening" -f $p.name, $p.port) "WARN" }
}

# HTTP contract check when loopback :3462 is up (persistent agent health server).
if (-not ($down | Where-Object { $_.port -eq 3462 })) {
    Test-AgentHealth3462 | Out-Null
}

& pm2 list 2>&1 | ForEach-Object { Log "pm2: $_" }

if ($down.Count) {
    Log ("{0} probe(s) down: {1} - see pm2 logs <name> / hydi-logs" -f $down.Count, (($down | ForEach-Object name) -join ', ')) "WARN"
} else {
    Log "all probes listening" "OK"
}
Log "done. Manage with: pm2 status / pm2 logs <name> / pm2 save"
exit 0