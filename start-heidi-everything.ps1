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

  Heidi Agent (Phase 2 persistent loop, :3462) is started via PM2 app
  `heidi-agent` with HEIDI_AGENT_PERSISTENT_LOOP=true in ecosystem.config.js
  only for that app. HEIDI_ALLOW_EXEC is never set true by this script.

  SIGINT note (Windows): Ctrl+C in this PowerShell window does not reliably
  deliver SIGINT to PM2-supervised node children. For graceful agent shutdown
  (final snapshot, lease_released in heidi-agent.js), use:
    pm2 stop heidi-agent

  heidi-bridge (:5050) lives OUTSIDE this repo at C:\ProtoForge_Ecosystem
  and is not PM2-managed - if it is needed, start it separately (see
  docs/runbooks/windows-autostart.md).

.PARAMETER SkipFrontend
  Deprecated/no-op kept for shortcut compatibility. PM2 decides what runs.

.PARAMETER AgentOnly
  Start only the Heidi Agent PM2 component (persistent loop, health :3462).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File start-heidi-everything.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File start-heidi-everything.ps1 -AgentOnly
#>
param(
    [switch]$SkipFrontend,   # deprecated: accepted for compatibility, ignored
    [switch]$AgentOnly
)

$Root       = "C:\Users\Owner\HYDI-System-v2"
$LogDir     = "C:\Users\Owner\hydi-logs"
$Ecosystem  = Join-Path $Root "ecosystem.config.js"
$HeidiAgentPort = 3462
$HeidiAgentLog  = "C:\ProtoForge_Ecosystem\logs\heidi-agent.log"

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $HeidiAgentLog) | Out-Null
$BootLog = Join-Path $LogDir ("pm2-boot-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

$script:AgentLogActive = $false
$script:BootSummary = [System.Collections.Generic.List[object]]::new()

function Log {
    param([string]$Msg, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Msg
    $color = switch ($Level) { "OK" { "Green" } "WARN" { "Yellow" } "FAIL" { "Red" } default { "Gray" } }
    Write-Host $line -ForegroundColor $color
    Add-Content -Path $BootLog -Value $line
    if ($script:AgentLogActive) {
        Add-Content -Path $HeidiAgentLog -Value $line
    }
}

function Test-TcpPortOpen {
    param(
        [int]$Port,
        [string]$HostName = '127.0.0.1',
        [int]$TimeoutMs = 2000
    )
    $open = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $iar = $c.BeginConnect($HostName, $Port, $null, $null)
        $open = $iar.AsyncWaitHandle.WaitOne($TimeoutMs) -and $c.Connected
        $c.Close()
    } catch {}
    return $open
}

function Test-AgentHealth3462 {
    param([int]$TimeoutSec = 5)
    try {
        $uri = "http://127.0.0.1:$HeidiAgentPort/health"
        $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
            Log "Heidi Agent GET $uri OK" "OK"
            return @{ ok = $true; body = $resp.Content }
        }
        Log "Heidi Agent health HTTP $($resp.StatusCode)" "WARN"
        return @{ ok = $false; body = $null }
    } catch {
        Log "Heidi Agent health probe failed: $($_.Exception.Message)" "WARN"
        return @{ ok = $false; body = $null }
    }
}

function Start-HeidiAgentComponent {
    $script:AgentLogActive = $true
    Log "=== Heidi Agent component (port $HeidiAgentPort, HEIDI_AGENT_PERSISTENT_LOOP via PM2) ===" "INFO"
    Log "Agent boot log: $HeidiAgentLog" "INFO"
    Log "HEIDI_ALLOW_EXEC: not set here (ecosystem default false)" "INFO"

    $alreadyUp = Test-TcpPortOpen -Port $HeidiAgentPort
    if ($alreadyUp) {
        Log "Heidi Agent :$HeidiAgentPort already listening — idempotent skip pm2 start" "OK"
    } else {
        Log "Heidi Agent :$HeidiAgentPort closed — pm2 start --only heidi-agent" "INFO"
        Push-Location $Root
        try {
            & pm2 start $Ecosystem --only heidi-agent 2>&1 | ForEach-Object { Log "pm2 start: $_" }
        } finally { Pop-Location }
    }

    Start-Sleep -Seconds 10
    $portNow = Test-TcpPortOpen -Port $HeidiAgentPort
    $health = Test-AgentHealth3462
    $allowExec = $null
    if ($health.ok -and $health.body) {
        try {
            $parsed = $health.body | ConvertFrom-Json
            $allowExec = $parsed.allow_exec
            if ($allowExec -eq $true) {
                Log "Heidi Agent health reports allow_exec=true — fix ecosystem env" "FAIL"
            }
        } catch {}
    }

    $script:BootSummary.Add([pscustomobject]@{
            Component  = 'Heidi Agent'
            Port       = $HeidiAgentPort
            TcpListen  = $portNow
            HealthOk   = $health.ok
            AllowExec  = $allowExec
            Persistent = 'true (ecosystem heidi-agent app only)'
        })

    if (-not $health.ok) {
        Log "Heidi Agent component unhealthy — see pm2 logs heidi-agent" "WARN"
        return $false
    }
    Log "Heidi Agent component ready" "OK"
    return $true
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
if ($AgentOnly) {
    $agentOk = Start-HeidiAgentComponent
    & pm2 list 2>&1 | ForEach-Object { Log "pm2: $_" }
    Log "--- boot summary ---" "INFO"
    foreach ($row in $script:BootSummary) {
        Log ("  {0}" -f ($row | ConvertTo-Json -Compress)) "INFO"
    }
    if (-not $agentOk) { exit 1 }
    Log "AgentOnly done" "OK"
    exit 0
}

Push-Location $Root
try {
    & pm2 resurrect 2>&1 | ForEach-Object { Log "resurrect: $_" }
    & pm2 start $Ecosystem 2>&1 | ForEach-Object { Log "pm2 start: $_" }
} finally { Pop-Location }

Start-Sleep -Seconds 10

# Heidi Agent: port check + health even when full fleet started (idempotent).
$null = Start-HeidiAgentComponent

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
    $open = Test-TcpPortOpen -Port $p.port
    if ($open) { $ok++; Log ("{0} :{1} listening" -f $p.name, $p.port) "OK" }
    else { $down += $p; Log ("{0} :{1} NOT listening" -f $p.name, $p.port) "WARN" }
}

& pm2 list 2>&1 | ForEach-Object { Log "pm2: $_" }

Log "--- boot summary ---" "INFO"
foreach ($row in $script:BootSummary) {
    Log ("  {0}" -f ($row | ConvertTo-Json -Compress)) "INFO"
}

if ($down.Count) {
    Log ("{0} probe(s) down: {1} - see pm2 logs <name> / hydi-logs" -f $down.Count, (($down | ForEach-Object name) -join ', ')) "WARN"
} else {
    Log "all probes listening" "OK"
}
Log "done. Manage with: pm2 status / pm2 logs <name> / pm2 save"
exit 0