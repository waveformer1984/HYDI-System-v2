# Focused ProtoForge Cleanup - Signal over Noise
param(
    [switch]$Force,
    [switch]$Backup,
    [switch]$RealScan
)

Write-Host "Focused ProtoForge Cleanup" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan

# Check if we're in HYDI_System
$currentDir = Get-Location
if (-not ($currentDir.Path -like "*HYDI_System*")) {
    Write-Host "ERROR: Not in HYDI_System directory" -ForegroundColor Red
    exit 1
}

# Define what to actually scan
$highRiskPaths = @(
    "pages/api/*.js",
    "scripts/*.js", 
    "keeper/*",
    "setup-*.js",
    "modules/keymaker*.js",
    "src/**/*.js",
    "workers/*.js",
    "*.env*"
)

$mediumRiskPaths = @(
    "*.md",
    "test-*.js",
    "*-test.js"
)

$excludePaths = @(
    "node_modules",
    "dist",
    ".next",
    ".git",
    "cleanup",
    "skills",
    "agents"
)

# Real secret patterns (not noise)
$realSecretPatterns = @(
    "sk_live_[a-zA-Z0-9]{24,}",  # Real Stripe live keys
    "rk_live_[a-zA-Z0-9]{24,}",  # Real Stripe live keys (alt format)
    "sbp_[a-zA-Z0-9]{40,}",      # Supabase service role
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", # JWT tokens (common)
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----"
)

if ($RealScan) {
    Write-Host "`n🔍 FOCUSED SCAN - Real Risks Only" -ForegroundColor Yellow
    Write-Host "================================" -ForegroundColor Yellow
    
    $realRisks = @()
    
    # Scan high-risk paths
    Write-Host "`nScanning high-risk areas..." -ForegroundColor Yellow
    foreach ($pathPattern in $highRiskPaths) {
        Get-ChildItem -Path $pathPattern -Exclude $excludePaths -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
                if ($content) {
                    foreach ($pattern in $realSecretPatterns) {
                        if ($content -match $pattern) {
                            # Extract the actual secret (masked)
                            $matches = [regex]::Matches($content, $pattern)
                            foreach ($match in $matches) {
                                $masked = $match.Value.Substring(0, 8) + "***"
                                $realRisks += @{
                                    file = $_.FullName
                                    type = "REAL_SECRET"
                                    pattern = $pattern
                                    masked = $masked
                                    line = ($content -split "`n" | Where-Object { $_ -match $pattern }).Count
                                }
                            }
                        }
                    }
                }
            } catch {
                # Skip files that can't be read
            }
        }
    }
    
    # Report real risks
    if ($realRisks.Count -gt 0) {
        Write-Host "`n🚨 REAL SECRETS FOUND:" -ForegroundColor Red
        foreach ($risk in $realRisks) {
            Write-Host "  File: $($risk.file)" -ForegroundColor Red
            Write-Host "  Type: $($risk.type)" -ForegroundColor Red
            Write-Host "  Secret: $($risk.masked)" -ForegroundColor Red
            Write-Host "  Line: $($risk.line)" -ForegroundColor Red
            Write-Host ""
        }
        
        Write-Host "CRITICAL: These are actual secrets that need rotation!" -ForegroundColor Red
        Write-Host "1. Rotate Stripe keys in Stripe Dashboard"
        Write-Host "2. Rotate Supabase keys in Supabase Dashboard"
        Write-Host "3. Move secrets to environment variables"
        
    } else {
        Write-Host "`n✅ No real secrets detected in project code" -ForegroundColor Green
    }
    
    # Check for secrets in code (not just patterns)
    Write-Host "`n🔍 Checking for hardcoded secrets..." -ForegroundColor Yellow
    $hardcodedSecrets = @()
    
    Get-ChildItem -Path "*.js" -Exclude $excludePaths -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            if ($content) {
                # Look for actual hardcoded assignments
                $assignments = [regex]::Matches($content, '(const|let|var)\s+\w+\s*=\s*["\']([^"\']{20,})["\']')
                foreach ($assignment in $assignments) {
                    $value = $assignment.Groups[2].Value
                    if ($value -match "sk_" -or $value -match "sbp_" -or $value.Length -gt 50) {
                        $hardcodedSecrets += @{
                            file = $_.FullName
                            type = "HARDCODED_SECRET"
                            variable = $assignment.Groups[1].Value
                            value = $value.Substring(0, 8) + "***"
                            line = ($content -split "`n" | Where-Object { $_ -match $assignment.Value }).Count
                        }
                    }
                }
            }
        } catch {
            # Skip files that can't be read
        }
    }
    
    if ($hardcodedSecrets.Count -gt 0) {
        Write-Host "`n🟡 HARDCODED SECRETS IN CODE:" -ForegroundColor Yellow
        foreach ($secret in $hardcodedSecrets) {
            Write-Host "  File: $($secret.file)" -ForegroundColor Yellow
            Write-Host "  Variable: $($secret.variable)" -ForegroundColor Yellow
            Write-Host "  Value: $($secret.value)" -ForegroundColor Yellow
            Write-Host ""
        }
    }
    
} else {
    Write-Host "`n📊 Cleanup Impact (No Scanning):" -ForegroundColor Yellow
    
    # Calculate cleanup impact (excluding node_modules)
    $tempSize = 0
    $buildSize = 0
    
    # Check temp files
    $tempPaths = @("$env:TEMP", "$env:LOCALAPPDATA\Temp")
    foreach ($path in $tempPaths) {
        if (Test-Path $path) {
            try {
                $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                $tempSize += $size
            } catch {
                # Skip if can't access
            }
        }
    }
    
    # Check build artifacts (excluding node_modules)
    $buildPaths = @(".\hydi-monitor-deploy\.next", ".\hydi-npm\node_modules")
    foreach ($path in $buildPaths) {
        if (Test-Path $path) {
            try {
                $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                $buildSize += $size
            } catch {
                # Skip if can't access
            }
        }
    }
    
    $totalSize = $tempSize + $buildSize
    Write-Host "Temp files: $([math]::Round($tempSize / 1MB, 2)) MB"
    Write-Host "Build artifacts: $([math]::Round($buildSize / 1MB, 2)) MB"
    Write-Host "Total cleanup potential: $([math]::Round($totalSize / 1MB, 2)) MB"
    Write-Host ""
    Write-Host "Use -RealScan to check for actual secrets in project code" -ForegroundColor Cyan
}

# Generate focused report
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    mode = if ($RealScan) { "real_scan" } else { "cleanup_only" }
    tempSize = [math]::Round($tempSize / 1MB, 2)
    buildSize = [math]::Round($buildSize / 1MB, 2)
    excludes = $excludePaths
}

$reportPath = ".\cleanup\focused-cleanup-report.json"
$report | ConvertTo-Json | Out-File $reportPath -Encoding UTF8

Write-Host "`nFocused report saved to: $reportPath"
Write-Host "Focused cleanup complete!" -ForegroundColor Green

if (-not $RealScan) {
    Write-Host "`n💡 Next steps:" -ForegroundColor Cyan
    Write-Host "1. Run with -RealScan to check for actual secrets"
    Write-Host "2. Focus on project code, not dependencies"
    Write-Host "3. Move any found secrets to environment variables"
}
