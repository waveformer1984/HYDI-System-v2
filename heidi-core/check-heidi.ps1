# HEIDI 48-hour bake diagnostic
# Run this after letting the server run idle to see what it learned

$base = "http://127.0.0.1:3458"

Write-Host "`n=== HEIDI Health ===" -ForegroundColor Cyan
Invoke-RestMethod "$base/health" | ConvertTo-Json

Write-Host "`n=== Phase 5 Status ===" -ForegroundColor Cyan
Invoke-RestMethod "$base/phase5/status" | ConvertTo-Json -Depth 4

Write-Host "`n=== Synthesized Insights (last 10) ===" -ForegroundColor Cyan
Invoke-RestMethod "$base/phase5/insights?limit=10" | ConvertTo-Json -Depth 4

Write-Host "`n=== Optimizer Status ===" -ForegroundColor Cyan
Invoke-RestMethod "$base/optimizer/status" | ConvertTo-Json

Write-Host "`n=== Recent Optimizer Results ===" -ForegroundColor Cyan
Invoke-RestMethod "$base/optimizer/recent?limit=5" | ConvertTo-Json -Depth 4

Write-Host "`n=== Autonomous Queue ===" -ForegroundColor Cyan
Invoke-RestMethod "$base/queue" | ConvertTo-Json -Depth 3

Write-Host "`n=== pm2 Process Status ===" -ForegroundColor Cyan
pm2 list
