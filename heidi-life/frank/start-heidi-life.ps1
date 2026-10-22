# Starts Heidi Life on Frank. Add the block at the bottom to start-heidi-everything.ps1,
# or run this file directly.  Requires Node 22.13+  (node --version)
param(
  [string]$Root = "C:\ProtoForge_Ecosystem\heidi-life",
  [int]$Port = 3470
)
$ErrorActionPreference = "Stop"
$logDir = "C:\ProtoForge_Ecosystem\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# idempotent: skip if already listening
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Heidi Life already running on :$Port"; return
}

# Gate 1 lives here. Leave it unset/false until you've watched a week of REVIEW verdicts.
# $env:HEIDI_ALLOW_EXEC = "true"

Start-Process -FilePath "node" -ArgumentList "--no-warnings","src/server.js" `
  -WorkingDirectory $Root -WindowStyle Hidden `
  -RedirectStandardOutput "$logDir\heidi-life.out.log" -RedirectStandardError "$logDir\heidi-life.err.log"

Start-Sleep -Seconds 3
try {
  Invoke-RestMethod "http://127.0.0.1:$Port/api/summary" | Out-Null
  Write-Host "Heidi Life OK  ->  http://127.0.0.1:$Port/"
} catch { Write-Warning "Heidi Life did not answer on :$Port — see $logDir\heidi-life.err.log" }

# One-time: let the phone reach Frank on the LAN only (Private profile), not the internet.
# New-NetFirewallRule -DisplayName "Heidi Life (LAN)" -Direction Inbound -Protocol TCP -LocalPort 3470 -Profile Private -Action Allow
