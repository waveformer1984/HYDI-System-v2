# heidi-clean.ps1 -- CLEANUP ONLY.
# Kills whatever is listening on the HEIDI control-plane port (default 3458) and
# NOTHING else. It never touches node processes machine-wide: the hub
# (heidi-web :3000, protoforge-core :3005) and mobile UI (:3006) are external
# dependencies, not targets. See HEIDI.ps1 for the full port map.
param([int]$Port = 3458)

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        try {
            Stop-Process -Id $_ -Force -ErrorAction Stop
            Write-Host "  [clean] killed PID $_ on port $Port" -ForegroundColor Green
        } catch {
            Write-Host "  [clean] could not kill PID $_ on port $Port : $_" -ForegroundColor Yellow
        }
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "  [clean] nothing listening on port $Port" -ForegroundColor Gray
}
