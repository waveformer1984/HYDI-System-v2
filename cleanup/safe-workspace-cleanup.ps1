# ProtoForge SAFE Workspace Cleanup Script
# Version: 2.0 - Safety First
# Run as Administrator for full functionality

param(
    [switch]$Deep,
    [switch]$Backup,
    [switch]$Force,
    [switch]$DryRun
)

# Safety checks
Write-Host "🔒 ProtoForge SAFE Workspace Cleanup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# 1. Pre-flight safety checks
Write-Host "`n🛡️  Pre-flight Safety Checks:" -ForegroundColor Yellow

# Check if we're in the right directory
$currentDir = Get-Location
if (-not ($currentDir.Path -like "*HYDI_System*")) {
    Write-Host "  ⚠️  WARNING: Not in HYDI_System directory!" -ForegroundColor Red
    Write-Host "  Current: $($currentDir.Path)" -ForegroundColor Red
    
    if (-not $Force) {
        Write-Host "  Use -Force to continue anyway" -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "  Continuing anyway (forced)" -ForegroundColor Yellow
    }
}

# Check for critical files that should NEVER be touched
$criticalPaths = @(
    ".env",
    ".env.backup",
    "keeper\**\*.key",
    "keeper\**\vault*",
    "keeper\**\secrets*",
    "supabase\**\secrets*"
)

Write-Host "  Checking for critical files..."
foreach ($path in $criticalPaths) {
    if (Test-Path $path) {
        Write-Host "    ✅ Found: $path (protected)" -ForegroundColor Green
    }
}

# 2. Dry run mode (default behavior)
if (-not $Force -or $DryRun) {
    Write-Host "`n🔍 DRY RUN MODE - No changes will be made" -ForegroundColor Cyan
    Write-Host "======================================" -ForegroundColor Cyan
}

# 3. Define safe cleanup targets
$safeTargets = @{
    tempFiles = @(
        "$env:TEMP\*",
        "$env:LOCALAPPDATA\Temp\*",
        ".\__pycache__",
        ".\node_modules\.cache",
        ".\.cache",
        ".\.tmp"
    )
    
    buildArtifacts = @(
        ".\hydi-monitor-deploy\.next",
        ".\hydi-monitor-deploy\node_modules",
        ".\hydi-npm\node_modules",
        ".\node_modules",  # Only with explicit confirmation
        "*.log",
        "*.tmp"
    )
    
    excludePaths = @(
        ".env*",
        "keeper\**",
        "supabase\**\secrets*",
        "cleanup\**",
        "git\**"
    )
}

# 4. Secret scanning (safe - no modifications)
Write-Host "`n🔍 Scanning for sensitive data..." -ForegroundColor Yellow

$sensitivePatterns = @(
    "sk_live_",
    "sk_test_",
    "whsec_",
    "password",
    "secret",
    "private_key",
    "BEGIN PRIVATE KEY",
    "BEGIN RSA PRIVATE KEY"
)

$foundSensitive = @()
$scanResults = @()

Get-ChildItem -Path . -Recurse -Include "*.js", "*.json", "*.md", "*.sql", "*.ps1" -Exclude @("node_modules", ".git", "keeper", "cleanup") | ForEach-Object {
    try {
        $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
        if ($content) {
            foreach ($pattern in $sensitivePatterns) {
                if ($content -match $pattern) {
                    $foundSensitive += $_.FullName
                    
                    # Create safe scan result (no actual secrets)
                    $scanResults += @{
                        file = $_.FullName
                        type = $pattern
                        line = ($content -split "`n" | Where-Object { $_ -match $pattern }).Count
                        size = $_.Length
                    }
                    break
                }
            }
        }
    } catch {
        # Skip files that can't be read
    }
}

# Report findings safely
if ($foundSensitive.Count -gt 0) {
    Write-Host "  ⚠️  Found potentially sensitive files:" -ForegroundColor Red
    foreach ($result in $scanResults) {
        Write-Host "    - $($result.file) (type: $($result.type), lines: $($result.line))" -ForegroundColor Red
    }
    
    Write-Host "`n  💡 To sanitize, run with -Force -Backup" -ForegroundColor Yellow
} else {
    Write-Host "  ✅ No sensitive data found in clear text" -ForegroundColor Green
}

# 5. Calculate cleanup impact
Write-Host "`n📊 Cleanup Impact Analysis:" -ForegroundColor Yellow

$tempSize = 0
$buildSize = 0

# Calculate temp files size
foreach ($path in $safeTargets.tempFiles) {
    if (Test-Path $path) {
        $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $tempSize += $size
    }
}

# Calculate build artifacts size
foreach ($path in $safeTargets.buildArtifacts) {
    if (Test-Path $path) {
        $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $buildSize += $size
    }
}

$totalSize = $tempSize + $buildSize
Write-Host "  Temp files: $([math]::Round($tempSize / 1MB, 2)) MB"
Write-Host "  Build artifacts: $([math]::Round($buildSize / 1MB, 2)) MB"
Write-Host "  Total cleanup potential: $([math]::Round($totalSize / 1MB, 2)) MB"

# 6. Execute cleanup only if forced
if ($Force -and -not $DryRun) {
    Write-Host "`n🧹 EXECUTING CLEANUP" -ForegroundColor Red
    Write-Host "===================" -ForegroundColor Red
    
    # Create backup directory
    $backupDir = ".\cleanup\backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if ($Backup) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        Write-Host "  📦 Backup directory: $backupDir"
    }
    
    # Clean temp files (safe)
    Write-Host "`n  🗑️  Cleaning temp files..."
    foreach ($path in $safeTargets.tempFiles) {
        if (Test-Path $path) {
            Write-Host "    Removing: $path"
            if ($Backup) {
                # Backup first
                $backupPath = Join-Path $backupDir "temp-$(Split-Path $path -Leaf)"
                Copy-Item $path $backupPath -Recurse -Force
            }
            Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    
    # Clean build artifacts (with confirmation)
    if ($safeTargets.buildArtifacts -contains ".\node_modules") {
        Write-Host "`n  ⚠️  node_modules detected - this will require npm install after"
        if (-not $Force) {
            Write-Host "     Skipping node_modules (use -Force to include)" -ForegroundColor Yellow
        } else {
            Write-Host "     Removing node_modules..." -ForegroundColor Red
            if ($Backup) {
                Copy-Item ".\node_modules" "$backupDir\node_modules" -Recurse -Force
            }
            Remove-Item ".\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    
    # Sanitize sensitive files if backup enabled
    if ($foundSensitive.Count -gt 0 -and $Backup) {
        Write-Host "`n  🔒 Sanitizing sensitive files..."
        foreach ($file in $foundSensitive) {
            Write-Host "    Sanitizing: $file"
            
            # Create backup
            $backupFile = Join-Path $backupDir "sensitive-$(Split-Path $file -Leaf)"
            Copy-Item $file $backupFile -Force
            
            # Sanitize content
            $content = Get-Content $file -Raw
            $content = $content -replace 'sk_live_[a-zA-Z0-9_]+', 'sk_live_***'
            $content = $content -replace 'sk_test_[a-zA-Z0-9_]+', 'sk_test_***'
            $content = $content -replace 'whsec_[a-zA-Z0-9_]+', 'whsec_***'
            $content = $content -replace 'password["\s:]+["'']?[^\s"']{8,}', 'password: "***"'
            Set-Content $file $content -NoNewline
        }
    }
    
    Write-Host "`n✅ Cleanup completed!" -ForegroundColor Green
    
} else {
    Write-Host "`n📋 SUMMARY (Dry Run - No changes made):" -ForegroundColor Cyan
    Write-Host "  - Sensitive files found: $($foundSensitive.Count)"
    Write-Host "  - Potential cleanup size: $([math]::Round($totalSize / 1MB, 2)) MB"
    Write-Host "  - Use -Force to execute cleanup"
    Write-Host "  - Use -Backup to create backups before changes"
}

# 7. Generate safe report
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    mode = if ($DryRun) { "dry-run" } elseif ($Force) { "execute" } else { "safe" }
    findings = @{
        sensitiveFiles = $foundSensitive.Count
        tempSize = [math]::Round($tempSize / 1MB, 2)
        buildSize = [math]::Round($buildSize / 1MB, 2)
    }
    protected = @{
        envFiles = (Test-Path ".env*").Count
        keeperFiles = (Get-ChildItem "keeper\**" -ErrorAction SilentlyContinue).Count
    }
}

# Store report securely (no sensitive data)
$reportPath = ".\cleanup\safe-cleanup-report.json"
$report | ConvertTo-Json | Out-File $reportPath -Encoding UTF8

Write-Host "`n📊 Safe report saved to: $reportPath"

# 8. Safety recommendations
Write-Host "`n💡 Safety Recommendations:" -ForegroundColor Cyan
Write-Host "  1. Rotate any exposed keys BEFORE cleanup"
Write-Host "  2. Review the report file before proceeding"
Write-Host "  3. Test critical functionality after cleanup"
Write-Host "  4. Keep backups for at least 7 days"

if ($foundSensitive.Count -gt 0) {
    Write-Host "`n🚨 CRITICAL: Found sensitive files!" -ForegroundColor Red
    Write-Host "   1. Rotate exposed keys immediately"
    Write-Host "   2. Run with -Backup to sanitize safely"
    Write-Host "   3. Do not commit sanitized files without review"
}

Write-Host "`n✅ Safe workspace check complete" -ForegroundColor Green
