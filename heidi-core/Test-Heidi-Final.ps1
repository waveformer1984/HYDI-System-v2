Set-Location $PSScriptRoot
$base = "http://localhost:3456"
$passed = 0
$failed = 0

function Test-Endpoint($label, $method, $url, $body = $null) {
    try {
        $params = @{ Uri = $url; Method = $method; TimeoutSec = 30 }
        if ($body) {
            $params.Body = ($body | ConvertTo-Json)
            $params.ContentType = "application/json"
        }
        $r = Invoke-RestMethod @params
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:passed++
        return $r
    } catch {
        Write-Host "  FAIL  $label — $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
        return $null
    }
}

Write-Host "`nHEIDI Test Suite" -ForegroundColor Cyan
Write-Host "────────────────"

Test-Endpoint "Health check"       GET  "$base/health"
Test-Endpoint "Task list"          GET  "$base/tasks"
Test-Endpoint "Create task"        POST "$base/task"  @{ title="Test task"; description="From test suite"; priority="high" }
Test-Endpoint "Think (no Ollama)"  POST "$base/think" @{ input="Hello HEIDI"; sessionId="test" }

Write-Host "────────────────"
Write-Host "Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })

if ($failed -gt 0) {
    Write-Host "Is HEIDI running? Start with: .\Start-Heidi-Final.ps1" -ForegroundColor Yellow
}
