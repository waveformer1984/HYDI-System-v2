<#
.SYNOPSIS
    Publish ONLY the ProtoForge Walkie backend to the public internet with
    Tailscale Funnel, on port 8443, so phones that scan an invite QR can join.
    Idempotent: safe to re-run. Run on the HYDI PC from the repo.

.DESCRIPTION
    1. Ensures WALKIE_SESSION_SECRET exists in apps\walkie\server\.env
       (generated straight into the file; the value is never displayed).
    2. Checks the walkie server answers on http://127.0.0.1:8787/healthz.
       (Start it first; see apps\walkie\docs\QR_JOIN.md.)
    3. Runs `tailscale funnel --bg --https=8443 http://127.0.0.1:8787`.
       Port :8443 and the separately approved Galactic Bytes Funnel on :443
       are the only public listeners this script accepts. The :8470 MCP serve
       stays tailnet-only.
    4. Prints the PUBLIC_BASE_URL to put in apps\walkie\server\.env.

    Owner approved public exposure of the walkie backend (2026-10-13) and the
    ingress-gated Galactic Bytes surface on heidi-web (2026-10-24). Never point
    Funnel at the MCP server (:3470).

.PARAMETER Remove
    Turn the public 8443 Funnel off. Leaves every other serve alone.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\funnel-walkie.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\funnel-walkie.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$FunnelPort = 8443
$LocalPort  = 8787
$Root       = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvFile    = Join-Path $Root 'apps\walkie\server\.env'

function Need($cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' not found on PATH." }
}
Need tailscale

if ($Remove) {
    & tailscale funnel --https=$FunnelPort off 2>$null
    Write-Host "Public Funnel on :$FunnelPort is off (other serves untouched)." -ForegroundColor Green
    return
}

Need node

# 1. Session secret: presence check only; generate into the file if missing.
$hasSecret = (Test-Path $EnvFile) -and (Select-String -Path $EnvFile -Pattern '^\s*WALKIE_SESSION_SECRET\s*=\s*\S{32,}' -Quiet)
if ($hasSecret) {
    Write-Host "WALKIE_SESSION_SECRET: present in apps\walkie\server\.env"
} else {
    $line = & node -e "process.stdout.write('WALKIE_SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
    Add-Content -Path $EnvFile -Value ("`n" + $line)
    Remove-Variable line
    Write-Host "WALKIE_SESSION_SECRET: generated into apps\walkie\server\.env (value not shown). Restart the walkie server." -ForegroundColor Green
}

# 2. The walkie server must already be running locally.
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/healthz" -TimeoutSec 5
    if (-not $h.ok) { throw 'not ok' }
    Write-Host "walkie server: healthy on :$LocalPort"
} catch {
    throw "The walkie server is not answering on http://127.0.0.1:$LocalPort/healthz. Start it first (apps\walkie\docs\QR_JOIN.md)."
}

# 3. Funnel only :8443 -> :8787.
& tailscale funnel --bg --https=$FunnelPort "http://127.0.0.1:$LocalPort"
if ($LASTEXITCODE -ne 0) { throw "tailscale funnel failed (is Funnel allowed for this node in the tailnet policy? see apps\walkie\docs\QR_JOIN.md)." }

# Safety: Funnel must not be on for any other port.
$status = & tailscale funnel status --json | ConvertFrom-Json
$publicPorts = @()
if ($status.AllowFunnel) {
    foreach ($p in $status.AllowFunnel.PSObject.Properties) { if ($p.Value) { $publicPorts += ($p.Name -split ':')[-1] } }
}
$unexpected = $publicPorts | Where-Object { $_ -notin @("$FunnelPort", '443') }
if ($unexpected) {
    & tailscale funnel --https=$FunnelPort off 2>$null
    throw "Funnel is also public on port(s) $($unexpected -join ', '). Turned :$FunnelPort back off. Fix with 'tailscale funnel status' before retrying."
}

$dns = (& tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
$public = "https://${dns}:$FunnelPort"
Write-Host ""
Write-Host "Public walkie URL: $public" -ForegroundColor Green
Write-Host "Set in apps\walkie\server\.env:   PUBLIC_BASE_URL=$public"
Write-Host "LiveKit Cloud webhook URL:        $public/livekit/webhook"
Write-Host "Check from a phone on mobile data: $public/healthz  (expect {""ok"":true})"
