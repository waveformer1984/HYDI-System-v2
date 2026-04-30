# Simple ProtoForge Cleanup Script
param(
    [switch]$Force,
    [switch]$Backup
)

Write-Host "ProtoForge Cleanup Script" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan

# Check if we're in HYDI_System
$currentDir = Get-Location
if (-not ($currentDir.Path -like "*HYDI_System*")) {
    Write-Host "ERROR: Not in HYDI_System directory" -ForegroundColor Red
    Write-Host "Current: $($currentDir.Path)" -ForegroundColor Red
    exit 1
}

Write-Host "In correct directory: $($currentDir.Path)" -ForegroundColor Green

# Scan for sensitive data
Write-Host "`nScanning for sensitive data..." -ForegroundColor Yellow

$sensitivePatterns = @(
    "sk_live_",
    "sk_test_",
    "whsec_",
    "password",
    "secret",
    "private_key"
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
                    $scanResults += @{
                        file = $_.FullName
                        type = $pattern
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

# Report findings
if ($foundSensitive.Count -gt 0) {
    Write-Host "WARNING: Found potentially sensitive files:" -ForegroundColor Red
    foreach ($result in $scanResults) {
        Write-Host "  - $($result.file) (type: $($result.type))" -ForegroundColor Red
    }
    
    if ($Force -and $Backup) {
        Write-Host "`nSanitizing sensitive files..." -ForegroundColor Yellow
        
        # Create backup directory
        $backupDir = ".\cleanup\backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        Write-Host "Backup directory: $backupDir"
        
        foreach ($file in $foundSensitive) {
            Write-Host "Sanitizing: $file"
            
            # Create backup
            $backupFile = Join-Path $backupDir "sensitive-$(Split-Path $file -Leaf)"
            Copy-Item $file $backupFile -Force
            
            # Sanitize content
            $content = Get-Content $file -Raw
            $content = $content -replace 'sk_live_[a-zA-Z0-9_]+', 'sk_live_***'
            $content = $content -replace 'sk_test_[a-zA-Z0-9_]+', 'sk_test_***'
            $content = $content -replace 'whsec_[a-zA-Z0-9_]+', 'whsec_***'
            Set-Content $file $content -NoNewline
        }
        
        Write-Host "Sanitization complete!" -ForegroundColor Green
    } else {
        Write-Host "Use -Force -Backup to sanitize files" -ForegroundColor Yellow
    }
} else {
    Write-Host "No sensitive data found in clear text" -ForegroundColor Green
}

# Calculate cleanup impact
Write-Host "`nCleanup Impact Analysis:" -ForegroundColor Yellow

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

# Check build artifacts
$buildPaths = @(".\hydi-monitor-deploy\.next", ".\hydi-npm\node_modules", ".\node_modules")
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

# Generate report
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    sensitiveFiles = $foundSensitive.Count
    tempSize = [math]::Round($tempSize / 1MB, 2)
    buildSize = [math]::Round($buildSize / 1MB, 2)
}

$reportPath = ".\cleanup\cleanup-report.json"
$report | ConvertTo-Json | Out-File $reportPath -Encoding UTF8

Write-Host "`nReport saved to: $reportPath"
Write-Host "Cleanup script complete!" -ForegroundColor Green
