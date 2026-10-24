<#
.SYNOPSIS
    Manually expose heidi-web :3000 as public HTTPS through Tailscale Funnel.

.DESCRIPTION
    This script runs only when an operator invokes it. It does not install a
    service, scheduled task, PM2 app, or startup hook. The application ingress
    gate remains responsible for returning 404 on every non-Galactic-Bytes
    route reached through Funnel.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\frank-funnel.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\frank-funnel.ps1 --off
#>

$ErrorActionPreference = 'Stop'
$LocalOrigin = 'http://127.0.0.1:3000'
$PublicUrl = 'https://heidi-pc.tailc50af2.ts.net'
$Off = $args -contains '--off'
$Unknown = @($args | Where-Object { $_ -ne '--off' })

if ($Unknown.Count -gt 0) {
    throw "Unknown argument(s): $($Unknown -join ', '). Supported: --off"
}
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
    throw "'tailscale' not found on PATH."
}

if ($Off) {
    $Command = 'tailscale funnel --https=443 off'
    Write-Host "Command: $Command"
    & tailscale funnel --https=443 off
    if ($LASTEXITCODE -ne 0) { throw 'tailscale funnel off failed.' }
    Write-Host 'Public Funnel on HTTPS :443 is off (tailnet Serve is unchanged).' -ForegroundColor Green
    return
}

try {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri "$LocalOrigin/galactic-bytes" -TimeoutSec 5
    if ($Response.StatusCode -ne 200) { throw "HTTP $($Response.StatusCode)" }
} catch {
    throw "heidi-web is not serving $LocalOrigin/galactic-bytes. Start or repair it before enabling Funnel."
}

$Command = "tailscale funnel --bg --https=443 $LocalOrigin"
Write-Host "Command: $Command"
& tailscale funnel --bg --https=443 $LocalOrigin
if ($LASTEXITCODE -ne 0) {
    throw 'tailscale funnel failed. Confirm Funnel is allowed for heidi-pc in tailc50af2.ts.net.'
}

Write-Host "Public Galactic Bytes URL: $PublicUrl/galactic-bytes" -ForegroundColor Green
Write-Host "Stripe webhook URL:         $PublicUrl/api/billing/webhook"
Write-Host 'Private HYDI routes remain 404 through Funnel; LAN and tailnet access are unchanged.'
