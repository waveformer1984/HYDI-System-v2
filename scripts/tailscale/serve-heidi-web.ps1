<#
.SYNOPSIS
    Expose heidi-web (Next.js :3000) to the tailnet at HTTPS :443 for /heidi phone chat.
    Idempotent — safe to re-run on heidi-pc.

.DESCRIPTION
    1. Writes .runtime/phone-access-report.json (paste into chat if phone still fails)
    2. Probes http://127.0.0.1:3000/api/ping then /api/health
    3. If unhealthy: checks .next build, HYDI_SERVICE_SECRET presence, PM2 restart
    4. Registers tailscale serve 443 -> 127.0.0.1:3000 (tries alternate CLI syntax)
    5. Verifies tailnet https://<machine>/api/ping and /heidi

.PARAMETER Remove
    Turn off only the :443 serve mapping (other serves untouched).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\serve-heidi-web.ps1
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$Root      = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$LocalUrl  = 'http://127.0.0.1:3000'
$ReportDir = Join-Path $Root '.runtime'
$ReportPath = Join-Path $ReportDir 'phone-access-report.json'
$report = @{
    ts = (Get-Date).ToUniversalTime().ToString('o')
    machine = $env:COMPUTERNAME
    steps = @()
}

function Step($name, $ok, $detail) {
    $report.steps += @{ step = $name; ok = [bool]$ok; detail = "$detail" }
}

function Need($cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' not found on PATH." }
}

function Save-Report {
    if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null }
    $report | ConvertTo-Json -Depth 6 | Set-Content -Path $ReportPath -Encoding UTF8
    Write-Host "`nReport written: $ReportPath" -ForegroundColor Cyan
}

Need tailscale

if ($Remove) {
    & tailscale serve --https=443 off 2>$null
    Write-Host 'Turned off tailscale serve on :443 (8470 MCP and Funnel untouched).' -ForegroundColor Green
    exit 0
}

Set-Location $Root

function Test-Url($uri) {
    try {
        $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
        return @{ ok = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500); code = $r.StatusCode; body = $r.Content.Substring(0, [Math]::Min(120, $r.Content.Length)) }
    } catch {
        return @{ ok = $false; code = 0; error = $_.Exception.Message }
    }
}

# --- Tailscale self ---
try {
    $ts = & tailscale status --json 2>$null | ConvertFrom-Json
    $online = [bool]$ts.Self.Online
    $dns = $ts.Self.DNSName
    $tailIp = ($ts.Self.TailscaleIPs | Where-Object { $_ -match '^\d+\.' } | Select-Object -First 1)
    Step 'tailscale_self' $online "online=$online dns=$dns tailIp=$tailIp"
    if (-not $online) {
        Write-Host 'Tailscale reports this PC OFFLINE — phone cannot reach heidi-pc until Tailscale is connected here.' -ForegroundColor Red
    }
} catch {
    Step 'tailscale_self' $false $_.Exception.Message
    $dns = 'heidi-pc.tailc50af2.ts.net'
    $tailIp = $null
}

$buildId = Join-Path $Root '.next\BUILD_ID'
if (-not (Test-Path $buildId)) {
    Step 'next_build' $false 'missing .next/BUILD_ID — run: npm run build'
    Write-Host 'MISSING PRODUCTION BUILD (.next/BUILD_ID). heidi-web-standalone needs: npm run build' -ForegroundColor Red
} else {
    Step 'next_build' $true (Get-Content $buildId -Raw).Trim()
}

$envLocal = Join-Path $Root '.env.local'
$hasSecret = $false
if (Test-Path $envLocal) {
    $hasSecret = (Select-String -Path $envLocal -Pattern '^\s*HYDI_SERVICE_SECRET\s*=' -Quiet)
}
Step 'hydi_service_secret' $hasSecret $(if ($hasSecret) { 'present in .env.local' } else { 'MISSING — /heidi pairing returns 503' })
if (-not $hasSecret) {
    Write-Host 'HYDI_SERVICE_SECRET not in .env.local — mobile pairing will fail until set.' -ForegroundColor Yellow
}

function Test-LocalHeidiWeb {
    $ping = Test-Url "$LocalUrl/api/ping"
    if ($ping.ok) { return $ping }
    return Test-Url "$LocalUrl/api/health"
}

function Restart-HeidiWebIfNeeded {
    $probe = Test-LocalHeidiWeb
    Step 'local_ping' $probe.ok $(if ($probe.ok) { "HTTP $($probe.code)" } else { $probe.error })
    if ($probe.ok) {
        Write-Host "Local heidi-web OK (HTTP $($probe.code))." -ForegroundColor Green
        return
    }
    Write-Host "Local heidi-web not healthy ($($probe.error)) — restarting PM2..." -ForegroundColor Yellow
    if (-not (Test-Path $buildId)) {
        throw 'Cannot start heidi-web without a production build. On heidi-pc run: npm run build && pm2 restart heidi-web-standalone'
    }
    if (Get-Command pm2 -ErrorAction SilentlyContinue) {
        pm2 restart heidi-web-standalone 2>&1 | Out-Host
        Start-Sleep -Seconds 10
        $probe = Test-LocalHeidiWeb
        Step 'local_after_heidi_web_restart' $probe.ok $(if ($probe.ok) { "HTTP $($probe.code)" } else { $probe.error })
        if ($probe.ok) {
            Write-Host "heidi-web-standalone recovered (HTTP $($probe.code))." -ForegroundColor Green
            return
        }
        Write-Host 'heidi-web-standalone still down — trying hydi-boot...' -ForegroundColor Yellow
        pm2 restart hydi-boot 2>&1 | Out-Host
        Start-Sleep -Seconds 25
        $probe = Test-LocalHeidiWeb
        Step 'local_after_hydi_boot' $probe.ok $(if ($probe.ok) { "HTTP $($probe.code)" } else { $probe.error })
        if (-not $probe.ok) {
            throw "heidi-web still unreachable at $LocalUrl/api/ping after PM2 restarts. Run: pm2 logs heidi-web-standalone --err --lines 40"
        }
        Write-Host "heidi-web OK after hydi-boot (HTTP $($probe.code))." -ForegroundColor Green
    } else {
        throw "pm2 not on PATH and $LocalUrl/api/ping failed — start heidi-web (npm run boot or pm2 start ecosystem.config.js)."
    }
}

Restart-HeidiWebIfNeeded

Write-Host 'Configuring tailscale serve 443 -> 127.0.0.1:3000 ...' -ForegroundColor Cyan
$serveOk = $false
foreach ($cmd in @(
    @('serve', '--bg', '--https=443', 'http://127.0.0.1:3000'),
    @('serve', '--bg', '3000')
)) {
    $serveOut = & tailscale @cmd 2>&1
    if ($LASTEXITCODE -eq 0) {
        Step 'tailscale_serve' $true ($cmd -join ' ')
        $serveOk = $true
        break
    }
    Step 'tailscale_serve_attempt' $false "$($cmd -join ' ') exit=$LASTEXITCODE $($serveOut -join ' ')"
}
if (-not $serveOk) {
    throw 'tailscale serve failed for all syntax variants. Run: tailscale serve status ; tailscale version'
}
& tailscale serve status

if (-not $dns) { $dns = 'heidi-pc.tailc50af2.ts.net' }
$tailnetBase = "https://$($dns.TrimEnd('.'))"
$tailPing = "$tailnetBase/api/ping"
$tailHeidi  = "$tailnetBase/heidi"

Write-Host "`nTailnet URLs (phone: Tailscale ON, then open):" -ForegroundColor Cyan
Write-Host "  Smoke test: $tailPing"
Write-Host "  Chat PWA:   $tailHeidi"
Write-Host "  Dashboard:  $tailnetBase/"
if ($tailIp) {
    Write-Host "  Direct (no Serve, needs firewall): http://${tailIp}:3000/heidi" -ForegroundColor DarkGray
}

$tp = Test-Url $tailPing
Step 'tailnet_ping' $tp.ok $(if ($tp.ok) { "HTTP $($tp.code)" } else { $tp.error })
if ($tp.ok) {
    Write-Host "Tailnet /api/ping: HTTP $($tp.code) (Serve + heidi-web OK from this PC)." -ForegroundColor Green
} else {
    Write-Host "Tailnet /api/ping failed from this PC: $($tp.error)" -ForegroundColor Red
    Write-Host 'If local /api/ping works: MagicDNS, ACL (tag:hydi-host without member grant), or Serve misconfigured.'
}

$report.phone_checklist = @(
    'Tailscale app: Connected (not Expired key on phone)',
    'Machines list: heidi-pc shows Online (not Away/offline)',
    "Browser: open $tailPing first — should show alive JSON",
    "Then: $tailHeidi",
    'If ping works but /heidi blank: hard-refresh or try Chrome',
    'If nothing loads: ACL may block phone→heidi-pc — see docs/TAILSCALE.md tag:hydi-host grants'
)
$report.urls = @{ ping = $tailPing; heidi = $tailHeidi; dashboard = "$tailnetBase/" }

Save-Report
Write-Host "`nDone. Pair at /heidi if first visit. Paste phone-access-report.json in chat if still broken." -ForegroundColor Green
