# Heidi Cloudflare Tunnel — Windows
# Exposes http://localhost:3006 to a public HTTPS URL
# No account required. URL changes on each run unless you configure a named tunnel.
#
# Usage:
#   .\heidi-tunnel.ps1
#
# To use a persistent subdomain, create a free Cloudflare account at
# dash.cloudflare.com and run: cloudflared tunnel login

param(
    [int]$Port = 3006,
    [string]$CloudflaredPath = "$env:TEMP\cloudflared.exe"
)

$DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

if (-not (Test-Path $CloudflaredPath)) {
    Write-Host "Downloading cloudflared..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $CloudflaredPath -UseBasicParsing
        Write-Host "Downloaded to $CloudflaredPath" -ForegroundColor Green
    } catch {
        Write-Host "Download failed: $_" -ForegroundColor Red
        Write-Host "Manual download: $DownloadUrl" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host "Starting Cloudflare tunnel -> http://localhost:$Port" -ForegroundColor Green
Write-Host "Your public URL will appear below (look for trycloudflare.com link)." -ForegroundColor Yellow
Write-Host "Set HEIDI_PUBLIC_URL in your .env to share with external services." -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the tunnel." -ForegroundColor Gray
Write-Host ""

& $CloudflaredPath tunnel --url "http://localhost:$Port"
