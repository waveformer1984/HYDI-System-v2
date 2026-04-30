# ProtoForge Workspace Cleanup Script
# Run as Administrator for full cleanup

param(
    [switch]$Deep,
    [switch]$Backup,
    [switch]$Force
)

Write-Host "🧹 ProtoForge Workspace Cleanup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Clean temporary files and caches
Write-Host "`n📁 Cleaning temporary files..." -ForegroundColor Yellow
$tempPaths = @(
    "$env:TEMP\*",
    "$env:LOCALAPPDATA\Temp\*",
    ".\__pycache__",
    ".\node_modules\.cache",
    ".\cache",
    ".\tmp"
)

foreach ($path in $tempPaths) {
    if (Test-Path $path) {
        Write-Host "  Cleaning: $path"
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 2. Clean build artifacts
Write-Host "`n🔨 Cleaning build artifacts..." -ForegroundColor Yellow
$buildPaths = @(
    ".\hydi-monitor-deploy\.next",
    ".\hydi-monitor-deploy\node_modules",
    ".\hydi-npm\node_modules",
    ".\node_modules",
    "*.log",
    "*.tmp",
    ".\dist",
    ".\build"
)

foreach ($path in $buildPaths) {
    if (Test-Path $path) {
        Write-Host "  Removing: $path"
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 3. Clean sensitive data from workspace
Write-Host "`n🔒 Scanning for sensitive data..." -ForegroundColor Yellow
$sensitivePatterns = @(
    "sk_live_",
    "sk_test_",
    "whsec_",
    "password",
    "secret",
    "private_key",
    "BEGIN PRIVATE KEY"
)

$foundSensitive = @()
Get-ChildItem -Path . -Recurse -Include "*.js", "*.json", "*.env*", "*.md", "*.sql", "*.ps1" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content) {
        foreach ($pattern in $sensitivePatterns) {
            if ($content -match $pattern) {
                $foundSensitive += $_.FullName
                break
            }
        }
    }
}

if ($foundSensitive.Count -gt 0) {
    Write-Host "  ⚠️  Found potentially sensitive files:" -ForegroundColor Red
    $foundSensitive | ForEach-Object { Write-Host "    - $_" }
    
    if ($Force -or $Deep) {
        Write-Host "`n  Sanitizing files..." -ForegroundColor Yellow
        foreach ($file in $foundSensitive) {
            Write-Host "    Sanitizing: $file"
            # Create backup if requested
            if ($Backup) {
                Copy-Item $file "$file.backup" -Force
            }
            # Remove sensitive content (simplified - in production use proper tool)
            $content = Get-Content $file -Raw
            $content = $content -replace 'sk_live_[a-zA-Z0-9_]+', 'sk_live_***'
            $content = $content -replace 'whsec_[a-zA-Z0-9_]+', 'whsec_***'
            Set-Content $file $content -NoNewline
        }
    }
} else {
    Write-Host "  ✅ No sensitive data found in clear text" -ForegroundColor Green
}

# 4. Clean Git history if deep clean
if ($Deep) {
    Write-Host "`n📚 Deep cleaning Git history..." -ForegroundColor Yellow
    if (Test-Path ".git") {
        # Remove large files from history
        git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch *.log *.tmp *.backup' --prune-empty --tag-name-filter cat -- --all 2>$null
        
        # Compress repository
        git gc --aggressive --prune=now
        Write-Host "  Git history cleaned and compressed"
    }
}

# 5. Organize workspace structure
Write-Host "`n📂 Organizing workspace..." -ForegroundColor Yellow
$folders = @(
    "archive",
    "backup",
    "docs",
    "scripts",
    "tests",
    "temp"
)

foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Write-Host "  Created: $folder"
    }
}

# Move old files to archive
$archiveExtensions = @("*.old", "*.bak", "*.backup", "*.log")
foreach ($ext in $archiveExtensions) {
    Get-ChildItem -Path . -Name $ext -Recurse | ForEach-Object {
        Move-Item $_ "archive\$_" -Force
        Write-Host "  Archived: $_"
    }
}

# 6. Clean package managers
Write-Host "`n📦 Cleaning package manager caches..." -ForegroundColor Yellow

# npm
if (Get-Command npm -ErrorAction SilentlyContinue) {
    npm cache clean --force
    Write-Host "  npm cache cleaned"
}

# pip
if (Get-Command pip -ErrorAction SilentlyContinue) {
    pip cache purge
    Write-Host "  pip cache cleaned"
}

# 7. Generate cleanup report
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    cleaned = @{
        tempFiles = $tempPaths.Count
        buildArtifacts = $buildPaths.Count
        sensitiveFiles = $foundSensitive.Count
    }
    workspaceSize = (Get-ChildItem -Path . -Recurse -File | Measure-Object -Property Length -Sum).Sum
    actions = @()
}

if ($foundSensitive.Count -gt 0 -and $Force) {
    $report.actions += "Sanitized sensitive files"
}
if ($Deep) {
    $report.actions += "Deep cleaned Git history"
}

$report | ConvertTo-Json | Out-File "cleanup\cleanup-report.json" -Encoding UTF8
Write-Host "`n📊 Cleanup report saved to: cleanup\cleanup-report.json"

# 8. Hardware optimization suggestions
Write-Host "`n💻 Hardware Optimization Suggestions:" -ForegroundColor Cyan
Write-Host "  1. Close unnecessary browser tabs (Chrome uses ~1GB per 10 tabs)"
Write-Host "  2. Restart IDE to clear memory leaks"
Write-Host "  3. Check disk space (need at least 10GB free for development)"
Write-Host "  4. Disable Windows Search indexing for project folder"
Write-Host "  5. Consider SSD upgrade if using HDD"

# Check system resources
$cpuUsage = Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction SilentlyContinue
$memUsage = Get-Counter '\Memory\Available MBytes' -ErrorAction SilentlyContinue

if ($cpuUsage) {
    Write-Host "`n📊 Current System Status:" -ForegroundColor Cyan
    Write-Host "  CPU Usage: $($cpuUsage.CounterSamples[0].CookedValue)%" -ForegroundColor $(if($cpuUsage.CounterSamples[0].CookedValue -gt 80) {"Red"} else {"Green"})
}

if ($memUsage) {
    $totalMem = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB
    $usedMem = $totalMem - $memUsage.CounterSamples[0].CookedValue
    $memPercent = ($usedMem / $totalMem) * 100
    Write-Host "  Memory Usage: $([math]::Round($memPercent, 1))% ($([math]::Round($usedMem, 0))MB used of $([math]::Round($totalMem, 0))MB)" -ForegroundColor $(if($memPercent -gt 80) {"Red"} else {"Green"})
}

Write-Host "`n✅ Workspace cleanup complete!" -ForegroundColor Green
