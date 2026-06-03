# Validate Colters Mobile PWA Specification
# Truth Standard: Verifiable artifacts only

param(
    [switch]$Detailed,
    [switch]$Quick
)

Write-Host "=== COLTERS MOBILE PWA SPEC VALIDATION ===" -ForegroundColor Cyan

$SpecPath = "ursula/specs/Colters_Mobile_PWA_SPEC.md"
$SpecFile = Get-Item $SpecPath -ErrorAction SilentlyContinue

if (-not $SpecFile) {
    Write-Host "❌ SPEC FILE NOT FOUND: $SpecPath" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Spec file exists: $($SpecFile.FullName)" -ForegroundColor Green
Write-Host "✅ File size: $($SpecFile.Length) bytes" -ForegroundColor Green

# Read and validate key sections
$Content = Get-Content $SpecPath -Raw

$RequiredSections = @(
    "Executive Summary",
    "Product Vision & Scope", 
    "Technical Architecture",
    "User Roles & Access Control",
    "Core API Specification",
    "Screen Specifications",
    "Mobile UI/UX Guidelines",
    "Offline Architecture",
    "PWA Configuration",
    "Security Considerations",
    "Performance Requirements",
    "Testing Strategy",
    "Success Metrics & KPIs",
    "Implementation Timeline",
    "Risk Mitigation",
    "Next Steps"
)

$MissingSections = @()
foreach ($Section in $RequiredSections) {
    if ($Content -notmatch [regex]::Escape("## $Section")) {
        $MissingSections += $Section
    }
}

if ($MissingSections.Count -gt 0) {
    Write-Host "❌ Missing required sections:" -ForegroundColor Red
    $MissingSections | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
    exit 1
} else {
    Write-Host "✅ All required sections present" -ForegroundColor Green
}

# Validate API endpoints
if ($Content -match "GET /api/mobile/dashboard/today" -and 
    $Content -match "GET /api/mobile/orders" -and
    $Content -match "PATCH /api/mobile/orders/:id" -and
    $Content -match "GET /api/mobile/smoke/batches" -and
    $Content -match "POST /api/mobile/logs/temp") {
    Write-Host "✅ Core API endpoints documented" -ForegroundColor Green
} else {
    Write-Host "❌ Core API endpoints missing" -ForegroundColor Red
    exit 1
}

# Validate JSON examples
$JsonBlocks = [regex]::Matches($Content, "```json[\s\S]*?```")
if ($JsonBlocks.Count -ge 5) {
    Write-Host "✅ JSON API examples present ($($JsonBlocks.Count) found)" -ForegroundColor Green
} else {
    Write-Host "❌ Insufficient JSON examples ($($JsonBlocks.Count) found, need ≥5)" -ForegroundColor Red
    exit 1
}

# Validate timeline
if ($Content -match "Phase 1: Foundation.*Weeks 1-2" -and
    $Content -match "Phase 2: Core MVP.*Weeks 3-5" -and
    $Content -match "Phase 3: Operational Depth.*Weeks 5-7") {
    Write-Host "✅ Implementation timeline defined" -ForegroundColor Green
} else {
    Write-Host "❌ Implementation timeline incomplete" -ForegroundColor Red
    exit 1
}

# Validate roles matrix
if ($Content -match "Access Control Matrix" -and
    $Content -match "Admin.*Production.*Fulfillment.*Compliance") {
    Write-Host "✅ Role-based access control defined" -ForegroundColor Green
} else {
    Write-Host "❌ Role-based access control missing" -ForegroundColor Red
    exit 1
}

if ($Detailed) {
    Write-Host "`n=== DETAILED VALIDATION ===" -ForegroundColor Cyan
    
    # Count API endpoints
    $ApiEndpoints = [regex]::Matches($Content, "(GET|POST|PATCH|PUT|DELETE) /api/mobile/")
    Write-Host "API endpoints documented: $($ApiEndpoints.Count)" -ForegroundColor Yellow
    
    # Count screen specifications
    $ScreenSections = [regex]::Matches($Content, "### \d+\.\d+ ")
    Write-Host "Screen specifications: $($ScreenSections.Count)" -ForegroundColor Yellow
    
    # Check for PWA manifest
    if ($Content -match "Web App Manifest") {
        Write-Host "✅ PWA manifest configuration included" -ForegroundColor Green
    }
    
    # Check for offline strategy
    if ($Content -match "Offline Architecture") {
        Write-Host "✅ Offline strategy documented" -ForegroundColor Green
    }
}

if ($Quick) {
    Write-Host "`n=== QUICK VALIDATION SUMMARY ===" -ForegroundColor Cyan
    Write-Host "Status: ✅ READY FOR DEVELOPMENT" -ForegroundColor Green
    Write-Host "Next: Review spec with development team" -ForegroundColor Yellow
} else {
    Write-Host "`n=== VALIDATION COMPLETE ===" -ForegroundColor Cyan
    Write-Host "Status: ✅ SPEC VERIFIED AND COMPLETE" -ForegroundColor Green
    Write-Host "Ready for: Development handoff, HYDI task creation, implementation planning" -ForegroundColor Yellow
}

Write-Host "`n📋 Spec validation completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
