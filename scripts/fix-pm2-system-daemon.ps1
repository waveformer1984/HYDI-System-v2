#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Kills the SYSTEM-owned PM2 daemon (spawned by NSSM HYDI_Orchestrator),
  clears all node processes, and resurrrects PM2 under the current user account.

  Run from an ELEVATED PowerShell (right-click -> Run as administrator):
    powershell -ExecutionPolicy Bypass -File F:\HYDI_System\scripts\fix-pm2-system-daemon.ps1
#>

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

Write-Host "`n[1/5] Stopping NSSM services that own the SYSTEM PM2 daemon..." -ForegroundColor Cyan
Stop-Service -Name 'HYDI_Orchestrator' -Force -ErrorAction SilentlyContinue
Stop-Service -Name 'HYDI_Dashboard'    -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "[2/5] Force-killing SYSTEM PM2 daemon(s) and any nssm.exe..." -ForegroundColor Cyan

# Dynamically find all node.exe processes whose command line contains 'PM2'
$pm2Procs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*PM2*' -or $_.CommandLine -like '*pm2*' }

if ($pm2Procs) {
  foreach ($p in $pm2Procs) {
    Write-Host "  Killing PM2 daemon PID $($p.ProcessId): $($p.CommandLine)"
    taskkill /PID $p.ProcessId /F 2>$null
  }
} else {
  Write-Host "  No PM2 daemon node process found (may already be gone)"
}

# Also try the previously-known PID as a fallback
taskkill /PID 29260 /F 2>$null

Get-Process nssm -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Verify pipe is gone
$pipeGone = -not ([System.IO.Directory]::GetFiles("\\.\pipe\") -contains "\\.\pipe\rpc.sock")
Write-Host "  rpc.sock pipe cleared: $pipeGone"

Write-Host "[3/5] Killing all node.exe to clear port bindings..." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host "[4/5] Resurrecting all PM2 apps from dump.pm2 (user-owned daemon)..." -ForegroundColor Cyan
Set-Location F:\HYDI_System
$resurrect = npx pm2 resurrect 2>&1
Write-Host $resurrect
Start-Sleep -Seconds 12   # allow consumer loop + reflection engine to boot

Write-Host "[5/5] Saving PM2 process list..." -ForegroundColor Cyan
$save = npx pm2 save 2>&1
Write-Host $save

Write-Host "`n=== Result ===" -ForegroundColor Green
npx pm2 list 2>&1

Write-Host "`nVerifying hydi-processor health..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
try {
  $h = (New-Object System.Net.WebClient).DownloadString('http://localhost:3003/health') | ConvertFrom-Json
  Write-Host "hydi-processor: PID=$($h.pid)  uptime=$($h.uptimeSec)s  status=$($h.status)"
} catch {
  Write-Host "hydi-processor health check failed (may still be starting)"
}

Write-Host "`n[DONE] PM2 is now running under user account. EPERM is resolved." -ForegroundColor Green
Write-Host "       You can now use 'npx pm2 list', 'npx pm2 save', etc. from any terminal."
