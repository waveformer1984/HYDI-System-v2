# Quick Real Secret Scan
param(
    [switch]$Force
)

Write-Host "Quick Real Secret Scan" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan

# Real secret patterns
$realSecretPatterns = @(
    "sk_live_[a-zA-Z0-9]{24,}",
    "rk_live_[a-zA-Z0-9]{24,}",
    "sbp_[a-zA-Z0-9]{40,}",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----"
)

# Files to check (excluding noise)
$filesToCheck = @(
    "*.env*",
    "setup-*.js",
    "scripts/*.js",
    "keeper/*",
    "modules/keymaker*.js",
    "src/**/*.js",
    "workers/*.js"
)

Write-Host "Scanning for real secrets..." -ForegroundColor Yellow

$realSecrets = @()

foreach ($pattern in $filesToCheck) {
    Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            if ($content) {
                foreach ($secretPattern in $realSecretPatterns) {
                    if ($content -match $secretPattern) {
                        $matches = [regex]::Matches($content, $secretPattern)
                        foreach ($match in $matches) {
                            $masked = $match.Value.Substring(0, 8) + "***"
                            $realSecrets += @{
                                file = $_.FullName
                                type = "REAL_SECRET"
                                secret = $masked
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

if ($realSecrets.Count -gt 0) {
    Write-Host "CRITICAL: Real secrets found!" -ForegroundColor Red
    foreach ($secret in $realSecrets) {
        Write-Host "File: $($secret.file)" -ForegroundColor Red
        Write-Host "Secret: $($secret.secret)" -ForegroundColor Red
        Write-Host ""
    }
    
    Write-Host "ACTION REQUIRED:" -ForegroundColor Red
    Write-Host "1. Rotate these keys immediately" -ForegroundColor Red
    Write-Host "2. Move to environment variables" -ForegroundColor Red
} else {
    Write-Host "No real secrets detected in project files" -ForegroundColor Green
}

# Check for hardcoded keys in a few key files
Write-Host "`nChecking hardcoded assignments..." -ForegroundColor Yellow

$hardcodedFound = $false
Get-ChildItem -Path "*.js" -Exclude "node_modules", ".git", "cleanup" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $lines = Get-Content $_.FullName -ErrorAction SilentlyContinue
        $lineNum = 0
        foreach ($line in $lines) {
            $lineNum++
            if ($line -match "sk_live_" -or $line -match "sbp_") {
                Write-Host "File: $($($_.FullName).Split('\')[-1])" -ForegroundColor Yellow
                Write-Host "Line $lineNum`: $($line.Trim())" -ForegroundColor Yellow
                $hardcodedFound = $true
            }
        }
    } catch {
        # Skip
    }
}

if (-not $hardcodedFound) {
    Write-Host "No hardcoded secrets found" -ForegroundColor Green
}

Write-Host "`nScan complete!" -ForegroundColor Green
