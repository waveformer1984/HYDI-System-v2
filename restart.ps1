# HYDI System - Restart Script
# Kills port 3000 (Next.js) and port 3005 (Express/HYDI), then restarts both

Set-Location C:\Users\Owner\HYDI_System

# Kill Next.js (port 3000)
$proc3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($proc3000) {
    Stop-Process -Id $proc3000.OwningProcess -Force
    Write-Host "Stopped process on port 3000 (Next.js)" -ForegroundColor Yellow
}

# Kill HYDI Express (port 3005)
$proc3005 = Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue
if ($proc3005) {
    Stop-Process -Id $proc3005.OwningProcess -Force
    Write-Host "Stopped process on port 3005 (HYDI server)" -ForegroundColor Yellow
}

# Start Next.js in background
Write-Host "Starting Next.js on port 3000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Users\Owner\HYDI_System; npm start" -WindowStyle Normal

# Start HYDI Express server
Write-Host "Starting HYDI Express server on port 3005..." -ForegroundColor Cyan
npm run server
