<#
.SYNOPSIS
  start-heidi-everything.ps1 - HYDI-System-v2 full-stack launcher (this PC / heidi-pc).
.DESCRIPTION
  Auto-launches Ollama, Heidi Core (heidi-core/server.js), Heidi Mobile
  (launch-heidi-mobile.js), the Heidi Bridge (:5050, Python/Flask from
  C:\ProtoForge_Ecosystem), and the Next.js frontend (:3000) at login.
  Idempotent: safe to re-run; skips anything already listening on its
  port. Logs everything to C:\Users\Owner\hydi-logs\.

  Covers every service in .ports.json except the external Supabase
  entries. Pass -SkipFrontend to leave the Next.js dev server (:3000)
  down (it is the heaviest process and not needed for headless work).

  NOTE: this is the version scoped to this machine's actual layout
  (C:\Users\Owner\HYDI-System-v2). The "Forge Loop" and "Ursula Suite"
  blocks from the original Frank-targeted script were dropped -- those
  files (orchestrator.js, ursula_event_bridge.py) don't exist in this
  repo. If you also run services on Frank, keep that as a separate script
  pointed at C:\ProtoForge_Ecosystem there.

  GOTCHA (bridge): the live heidi-bridge.py is the one in
  C:\ProtoForge_Ecosystem -- NOT the copy inside this repo. After editing
  it you must restart the :5050 process or the edit does nothing.
.NOTES
  Shortcut target (fixed, absolute -- no relative traversal):
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
  Arguments:
    -NoExit -ExecutionPolicy Bypass -File "C:\Users\Owner\HYDI-System-v2\start-heidi-everything.ps1"
  Start in:
    C:\Users\Owner\HYDI-System-v2
#>

param(
    [switch]$SkipFrontend   # leave the Next.js dev server (:3000) down
)

# ============================================================
#  CONFIG
# ============================================================
$Root       = "C:\Users\Owner\HYDI-System-v2"
$BridgeDir  = "C:\ProtoForge_Ecosystem"      # live heidi-bridge.py lives HERE, not in the repo
$LogDir     = "C:\Users\Owner\hydi-logs"     # kept outside the repo on purpose
$NodeExe    = "node"          # or full path e.g. "C:\Program Files\nodejs\node.exe"
$PythonExe  = "python"        # or full path e.g. "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"

# Ollama -- llama3.2:3b is the model already pulled on this machine this
# session; change if you've since switched models.
$OllamaModel = "llama3.2:3b"
$OllamaPort  = 11434

# Services: Name, WorkDir, StartCommand, Port (0 = no port check), HealthUrl, Env
# Ports match .ports.json (the repo's single source of truth):
#   heidi-core -> 3459, heidi-mobile-chat -> 3006
$Services = @(
    @{
        Name      = "Heidi Core (heidi-core/server.js)"
        WorkDir   = Join-Path $Root "heidi-core"
        Command   = "$NodeExe server.js"
        Port      = 3459
        HealthUrl = "http://localhost:3459/health"
        # HEIDI_PORT must be set explicitly -- server.js's own internal
        # default is 3456, which does NOT match .ports.json's 3459 or what
        # launch-heidi-mobile.js expects. HEIDI_ALLOW_EXEC stays false
        # unless you deliberately want the triple-gate execution path on.
        Env       = @{ HEIDI_PORT = "3459"; HEIDI_ALLOW_EXEC = "false" }
    },
    @{
        Name      = "Heidi Mobile (chat API, :3006)"
        WorkDir   = $Root
        Command   = "$NodeExe launch-heidi-mobile.js"
        Port      = 3006
        HealthUrl = "http://localhost:3006/api/health"
        # Explicit override so this works whether or not launch-heidi-mobile.js's
        # own default has been patched from the old (broken) :3456 to :3459.
        Env       = @{ HEIDI_CORE_URL = "http://localhost:3459" }
    },
    @{
        Name      = "Heidi Bridge (heidi-bridge.py, :5050)"
        WorkDir   = $BridgeDir
        Command   = "$PythonExe heidi-bridge.py"
        Port      = 5050
        HealthUrl = "http://localhost:5050/health"
        Env       = @{ BRIDGE_PORT = "5050" }
    }
)

if (-not $SkipFrontend) {
    $Services += @{
        Name      = "Next.js Frontend (:3000)"
        WorkDir   = $Root
        Command   = "npm run dev"
        Port      = 3000
        HealthUrl = "http://localhost:3000"
        Env       = @{ PORT = "3000" }
        # Next dev takes longer than the default 30s to bind on cold start,
        # and the first request triggers a compile that can exceed the
        # default 5s health-probe timeout.
        WaitSec   = 90
        HealthTimeoutSec = 90
    }
}

# ============================================================
#  SETUP
# ============================================================
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$BootLog = Join-Path $LogDir ("boot-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Log {
    param([string]$Msg, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Msg
    $color = switch ($Level) {
        "OK"    { "Green" }
        "WARN"  { "Yellow" }
        "FAIL"  { "Red" }
        default { "Gray" }
    }
    Write-Host $line -ForegroundColor $color
    Add-Content -Path $BootLog -Value $line
}

function Test-PortListening {
    param([int]$Port)
    if ($Port -eq 0) { return $false }
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Wait-ForPort {
    param([int]$Port, [int]$TimeoutSec = 30)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        if (Test-PortListening -Port $Port) { return $true }
        Start-Sleep -Milliseconds 750
    }
    return $false
}

function Test-Health {
    param([string]$Url, [int]$TimeoutSec = 5)
    if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return $r.StatusCode
    } catch {
        return $null
    }
}

function Start-Service-Window {
    param([hashtable]$Svc)
    if (-not (Test-Path $Svc.WorkDir)) {
        Log "$($Svc.Name): work dir not found: $($Svc.WorkDir) -- SKIPPED. Fix path in CONFIG block." "FAIL"
        return "MISSING"
    }
    if ($Svc.Port -gt 0 -and (Test-PortListening -Port $Svc.Port)) {
        Log "$($Svc.Name): already listening on port $($Svc.Port) -- skipping launch." "OK"
        return "ALREADY-UP"
    }
    $logFile = Join-Path $LogDir (($Svc.Name -replace '[^\w]', '_') + ".log")
    $envSet = ""
    foreach ($k in $Svc.Env.Keys) {
        $envSet += "`$env:$k = '$($Svc.Env[$k])'; "
    }
    $inner = "$envSet Set-Location '$($Svc.WorkDir)'; " +
             "Write-Host '=== $($Svc.Name) ===' -ForegroundColor Cyan; " +
             "$($Svc.Command) 2>&1 | Tee-Object -FilePath '$logFile' -Append"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $inner) `
        -WorkingDirectory $Svc.WorkDir `
        -WindowStyle Minimized | Out-Null
    Log "$($Svc.Name): launch issued ($($Svc.Command))"
    if ($Svc.Port -gt 0) {
        $waitSec = if ($Svc.ContainsKey('WaitSec')) { $Svc.WaitSec } else { 30 }
        if (Wait-ForPort -Port $Svc.Port -TimeoutSec $waitSec) {
            Log "$($Svc.Name): port $($Svc.Port) is up." "OK"
            return "UP"
        } else {
            Log "$($Svc.Name): port $($Svc.Port) not listening after ${waitSec}s -- check $logFile" "FAIL"
            return "NO-PORT"
        }
    }
    return "LAUNCHED"
}

# ============================================================
#  BANNER
# ============================================================
Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "   HYDI-System-v2 -- heidi-pc BOOT SEQUENCE" -ForegroundColor Cyan
Write-Host "  ================================================" -ForegroundColor Cyan
Log "Boot log: $BootLog"
Log "Root: $Root"

# ============================================================
#  STEP 1 -- Ollama
# ============================================================
Log "--- Step 1: Ollama ---"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    Log "ollama not found on PATH -- Heidi inference will be unavailable." "FAIL"
} else {
    if (Test-PortListening -Port $OllamaPort) {
        Log "Ollama already serving on $OllamaPort." "OK"
    } else {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden | Out-Null
        if (Wait-ForPort -Port $OllamaPort -TimeoutSec 20) {
            Log "Ollama started on $OllamaPort." "OK"
        } else {
            Log "Ollama failed to open port $OllamaPort within 20s." "FAIL"
        }
    }
    try {
        $models = & ollama list 2>$null | Out-String
        if ($models -match [regex]::Escape($OllamaModel)) {
            Log "Model '$OllamaModel' present." "OK"
        } else {
            Log "Model '$OllamaModel' NOT installed. Run: ollama pull $OllamaModel" "WARN"
        }
    } catch {
        Log "Could not enumerate Ollama models: $($_.Exception.Message)" "WARN"
    }
}

# ============================================================
#  STEP 1.5 -- Local Supabase (the data plane since 2026-07-07;
#  the cloud projects are dead. Needs Docker Desktop running.)
# ============================================================
Log "--- Step 1.5: Local Supabase (:54321) ---"
if (Test-PortListening -Port 54321) {
    Log "Local Supabase already up on 54321." "OK"
} elseif (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Log "supabase CLI not found -- data plane will be down. Install: scoop install supabase" "FAIL"
} else {
    $dockerUp = $false
    try { docker info 2>&1 | Out-Null; $dockerUp = ($LASTEXITCODE -eq 0) } catch {}
    if (-not $dockerUp) {
        Log "Docker Desktop is not running -- start it, then re-run this script for the data plane." "FAIL"
    } else {
        Log "Starting local Supabase stack (supabase start)..."
        Push-Location $Root
        supabase start 2>&1 | Out-File (Join-Path $LogDir "supabase-start.log") -Append
        Pop-Location
        if (Wait-ForPort -Port 54321 -TimeoutSec 120) {
            Log "Local Supabase up on 54321." "OK"
        } else {
            Log "Local Supabase failed to open 54321 -- see $LogDir\supabase-start.log" "FAIL"
        }
    }
}

# ============================================================
#  STEP 2 -- Services
# ============================================================
Log "--- Step 2: Services ---"
$results = @{}
foreach ($svc in $Services) {
    $results[$svc.Name] = Start-Service-Window -Svc $svc
}

# ============================================================
#  STEP 3 -- Health probes
# ============================================================
Log "--- Step 3: Health probes ---"
Start-Sleep -Seconds 3
foreach ($svc in $Services) {
    if (-not [string]::IsNullOrWhiteSpace($svc.HealthUrl)) {
        $probeSec = if ($svc.ContainsKey('HealthTimeoutSec')) { $svc.HealthTimeoutSec } else { 5 }
        $code = Test-Health -Url $svc.HealthUrl -TimeoutSec $probeSec
        if ($code -eq 200) {
            Log "$($svc.Name): health OK ($($svc.HealthUrl))" "OK"
        } elseif ($null -ne $code) {
            Log "$($svc.Name): health returned HTTP $code" "WARN"
        } else {
            Log "$($svc.Name): health endpoint unreachable ($($svc.HealthUrl))" "WARN"
        }
    }
}

# ============================================================
#  SUMMARY
# ============================================================
Write-Host ""
Write-Host "  -- BOOT SUMMARY ------------------------------" -ForegroundColor Cyan
foreach ($k in $results.Keys) {
    $status = $results[$k]
    $color = switch ($status) {
        "UP"          { "Green" }
        "ALREADY-UP"  { "Green" }
        "LAUNCHED"    { "Green" }
        "NO-PORT"     { "Red" }
        "MISSING"     { "Red" }
        default       { "Yellow" }
    }
    Write-Host ("  {0,-35} {1}" -f $k, $status) -ForegroundColor $color
}
Write-Host "  Logs: $LogDir" -ForegroundColor Gray
Write-Host ""
Log "Boot sequence complete."
