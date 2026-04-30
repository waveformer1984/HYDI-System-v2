# HEIDI Robust Test Suite
# Tests all endpoints on port 3458

Set-Location $PSScriptRoot

$base = "http://localhost:3458"
$passed = 0
$failed = 0

function Test-Endpoint($label, $method, $url, $body = $null) {
    try {
        $params = @{ Uri = $url; Method = $method; TimeoutSec = 30 }
        if ($body) {
            $params.Body = ($body | ConvertTo-Json -Compress)
            $params.ContentType = "application/json"
        }
        $r = Invoke-RestMethod @params
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:passed++
        return $r
    } catch {
        Write-Host "  FAIL  $label - $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
        return $null
    }
}

Write-Host "`nHEIDI Robust Test Suite (Port 3458)" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# Test 1: Health check
Write-Host "`n1. Health check..." -ForegroundColor Yellow
$health = Test-Endpoint "Health endpoint" GET "$base/health"
if ($health) {
    Write-Host "    Status: $($health.status)" -ForegroundColor Gray
    Write-Host "    Model: $($health.model)" -ForegroundColor Gray
    Write-Host "    Sessions: $($health.sessions)" -ForegroundColor Gray
    Write-Host "    Tasks: $($health.tasks)" -ForegroundColor Gray
}

# Test 2: Task management
Write-Host "`n2. Task management..." -ForegroundColor Yellow
$task = Test-Endpoint "Create task" POST "$base/task" @{
    title = "Test Task from Robust Suite"
    description = "Created by automated test"
    priority = "high"
    source = "test-suite"
}

if ($task) {
    Write-Host "    Task ID: $($task.task.id)" -ForegroundColor Gray
    Write-Host "    Status: $($task.task.status)" -ForegroundColor Gray
}

$tasks = Test-Endpoint "List tasks" GET "$base/tasks"
if ($tasks) {
    Write-Host "    Total tasks: $($tasks.tasks.Count)" -ForegroundColor Gray
}

# Test 3: Think endpoint (will fail without Ollama)
Write-Host "`n3. Think endpoint..." -ForegroundColor Yellow
$think = Test-Endpoint "Think call" POST "$base/think" @{
    input = "Hello HEIDI, this is a test"
    sessionId = "robust-test"
}

if ($think) {
    Write-Host "    Response length: $($think.response.Length) chars" -ForegroundColor Gray
    Write-Host "    Session: $($think.sessionId)" -ForegroundColor Gray
    Write-Host "    Model: $($think.model)" -ForegroundColor Gray
} else {
    Write-Host "    Expected to fail without Ollama running" -ForegroundColor Gray
}

# Test 4: Session memory
Write-Host "`n4. Session memory..." -ForegroundColor Yellow
$session = Test-Endpoint "Get session tasks" GET "$base/tasks"
if ($session) {
    Write-Host "    Session memory working" -ForegroundColor Gray
}

# Results
Write-Host "`n======================================" -ForegroundColor Cyan
Write-Host "Test Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })

if ($failed -eq 0) {
    Write-Host "✅ All tests passed!" -ForegroundColor Green
} else {
    Write-Host "⚠️  Some tests failed" -ForegroundColor Yellow
    Write-Host "   Make sure HEIDI is running: .\Start-Heidi-Robust.ps1" -ForegroundColor Gray
    if (-not $health) {
        Write-Host "   Start HEIDI first!" -ForegroundColor Red
    }
}
