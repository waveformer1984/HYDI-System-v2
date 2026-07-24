Write-Host "=== HYDI BOOT START ===" -ForegroundColor Cyan

taskkill /F /IM node.exe /T 2>$null
Start-Sleep -Seconds 2

$ports = @(9998,9999,9997)

foreach ($p in $ports) {
    $lines = netstat -ano | findstr ":$p"
    if ($lines) {
        $lines | ForEach-Object {
            $parts = ($_ -split '\s+') | Where-Object { $_ -match '^\d+$' }
            foreach ($pid in $parts) {
                taskkill /F /PID $pid 2>$null
            }
        }
    }
}

Start-Sleep -Seconds 2

Write-Host "[3/3] Starting Supervisor ONLY..." -ForegroundColor Cyan
Start-Process -NoNewWindow node supervisor.js

Start-Sleep -Seconds 5

Write-Host "=== HYDI BOOT COMPLETE ===" -ForegroundColor Green