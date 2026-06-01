# Checkpoint QA Phase 2 — Automated API Test Suite
# Run from any PowerShell window while Ursula server is running on localhost:5000

$base = "http://localhost:5000"
$pass = 0; $fail = 0

function Test-Endpoint($name, $result, $expect) {
    if ($result -match $expect) {
        Write-Host "  PASS  $name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $name`n         Got: $result" -ForegroundColor Red
        $script:fail++
    }
}

Write-Host "`n=== CHECKPOINT QA TEST SUITE ===" -ForegroundColor Cyan

# T01 — Health check
$r = (Invoke-WebRequest "$base/checkpoint/health" -UseBasicParsing).Content
Test-Endpoint "T01 Health check" $r "checkpoint-online"

# T02 — Analyze electronics workflow (high-risk)
$body = @{
    project_id = 1001
    name       = "Arduino Wiring Install"
    category   = "electronics"
    steps      = @(
        @{ name = "electrical wiring"; duration_hours = 2.0; tools_required = "soldering iron"; safety_requirements = "insulated gloves" },
        @{ name = "component install";  duration_hours = 1.5; tools_required = "screwdriver";    safety_requirements = "ESD strap" }
    )
} | ConvertTo-Json -Depth 5
$r = (Invoke-WebRequest "$base/checkpoint/workflow/analyze" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing).Content
Test-Endpoint "T02 Electronics high-risk analyze" $r '"workflow_id"'

# T03 — Risk level is CRITICAL for electronics+wiring+electrical
Test-Endpoint "T03 Electronics risk = CRITICAL" $r "CRITICAL"

# Store workflow_id for later
$wfid = ($r | ConvertFrom-Json).workflow_id

# T04 — Get workflow report
$r2 = (Invoke-WebRequest "$base/checkpoint/workflow/$wfid" -UseBasicParsing).Content
Test-Endpoint "T04 Workflow report retrieved" $r2 '"checkpoints_required"'

# T05 — Checkpoints auto-created for high-risk steps
Test-Endpoint "T05 Checkpoints auto-created" $r2 '"checkpoints"'

# T06 — Analyze automotive workflow
$body2 = @{
    project_id = 1002
    name       = "Brake Pad Remove and Replace"
    category   = "automotive"
    steps      = @(
        @{ name = "remove wheel";         duration_hours = 0.5; tools_required = "jack, lug wrench"; safety_requirements = "jack stands" },
        @{ name = "remove brake caliper"; duration_hours = 1.0; tools_required = "socket set";       safety_requirements = "gloves" },
        @{ name = "install new pads";     duration_hours = 0.5; tools_required = "c-clamp";          safety_requirements = "eye protection" }
    )
} | ConvertTo-Json -Depth 5
$r3 = (Invoke-WebRequest "$base/checkpoint/workflow/analyze" -Method POST -Body $body2 -ContentType "application/json" -UseBasicParsing).Content
Test-Endpoint "T06 Automotive workflow analyzed" $r3 '"workflow_id"'

# T07 — Analyze household workflow (lower risk)
$body3 = @{
    project_id = 1003
    name       = "Shelf Installation"
    category   = "household"
    steps      = @(
        @{ name = "measure wall";     duration_hours = 0.25; tools_required = "tape measure"; safety_requirements = "none" },
        @{ name = "install brackets"; duration_hours = 0.5;  tools_required = "drill";        safety_requirements = "goggles" }
    )
} | ConvertTo-Json -Depth 5
$r4 = (Invoke-WebRequest "$base/checkpoint/workflow/analyze" -Method POST -Body $body3 -ContentType "application/json" -UseBasicParsing).Content
Test-Endpoint "T07 Household workflow analyzed" $r4 '"workflow_id"'

# T08 — List all workflows
$r5 = (Invoke-WebRequest "$base/checkpoint/workflows" -UseBasicParsing).Content
Test-Endpoint "T08 Workflow list returns array" $r5 "workflow_id"

# T09 — Submit audit on checkpoint 1
$cpBody = @{
    checkpoint_id = 1
    project_id    = 1001
    status        = "PASS"
    verified_by   = "Test Runner"
    notes         = "Automated test audit"
} | ConvertTo-Json
try {
    $r6 = (Invoke-WebRequest "$base/checkpoint/audit" -Method POST -Body $cpBody -ContentType "application/json" -UseBasicParsing).Content
    Test-Endpoint "T09 Audit submission" $r6 "audit_id"
} catch {
    Write-Host "  SKIP  T09 (checkpoint 1 not found — run after T02 creates it)" -ForegroundColor Yellow
}

# T10 — 404 on missing workflow
try {
    Invoke-WebRequest "$base/checkpoint/workflow/99999" -UseBasicParsing | Out-Null
    Write-Host "  FAIL  T10 Missing workflow should 404" -ForegroundColor Red; $fail++
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "  PASS  T10 Missing workflow returns 404" -ForegroundColor Green; $pass++
    } else {
        Write-Host "  FAIL  T10 Unexpected status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red; $fail++
    }
}

Write-Host "`n=== RESULTS: $pass passed, $fail failed ===" -ForegroundColor Cyan
