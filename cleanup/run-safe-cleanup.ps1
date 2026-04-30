# ProtoForge Safe Cleanup Runner
# This script handles execution policy and runs cleanup safely

Write-Host "🔧 ProtoForge Safe Cleanup Runner" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan

# Check and set execution policy
$currentPolicy = Get-ExecutionPolicy -Scope CurrentUser
Write-Host "`n📋 Current execution policy: $currentPolicy"

if ($currentPolicy -eq "Restricted") {
    Write-Host "⚠️  Execution policy is Restricted - setting to RemoteSigned" -ForegroundColor Yellow
    try {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Write-Host "✅ Execution policy updated to RemoteSigned" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to set execution policy. Run as Administrator?" -ForegroundColor Red
        Write-Host "   Or run: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor Yellow
        exit 1
    }
}

# Check if we're in the right directory
$currentDir = Get-Location
if (-not ($currentDir.Path -like "*HYDI_System*")) {
    Write-Host "❌ Not in HYDI_System directory" -ForegroundColor Red
    Write-Host "   Current: $($currentDir.Path)" -ForegroundColor Red
    Write-Host "   Navigate to HYDI_System directory first" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ In correct directory: $($currentDir.Path)" -ForegroundColor Green

# Menu for user choice
Write-Host "`n📋 Choose cleanup option:" -ForegroundColor Cyan
Write-Host "1. Workspace cleanup (dry run)"
Write-Host "2. Workspace cleanup (execute with backup)"
Write-Host "3. Hardware optimization (dry run)"
Write-Host "4. Hardware optimization (safe mode)"
Write-Host "5. Hardware optimization (full)"
Write-Host "6. Exit"

do {
    $choice = Read-Host "`nSelect option (1-6)"
    
    switch ($choice) {
        "1" {
            Write-Host "`n🔍 Running workspace cleanup (dry run)..." -ForegroundColor Yellow
            & ".\cleanup\safe-workspace-cleanup.ps1" -DryRun
        }
        
        "2" {
            Write-Host "`n⚠️  This will clean and backup files. Continue? (y/N)" -ForegroundColor Yellow
            $confirm = Read-Host
            if ($confirm -eq "y" -or $confirm -eq "Y") {
                Write-Host "🧹 Running workspace cleanup (with backup)..." -ForegroundColor Yellow
                & ".\cleanup\safe-workspace-cleanup.ps1" -Force -Backup
            } else {
                Write-Host "Cancelled" -ForegroundColor Yellow
            }
        }
        
        "3" {
            Write-Host "`n🔍 Running hardware optimization (dry run)..." -ForegroundColor Yellow
            & ".\cleanup\safe-hardware-optimization.ps1" -DryRun
        }
        
        "4" {
            Write-Host "`n⚡ Running hardware optimization (safe mode)..." -ForegroundColor Yellow
            & ".\cleanup\safe-hardware-optimization.ps1" -Apply -SafeMode -CreateRestorePoint
        }
        
        "5" {
            Write-Host "`n⚠️  This will apply aggressive optimizations. Continue? (y/N)" -ForegroundColor Yellow
            $confirm = Read-Host
            if ($confirm -eq "y" -or $confirm -eq "Y") {
                Write-Host "⚡ Running hardware optimization (full)..." -ForegroundColor Yellow
                & ".\cleanup\safe-hardware-optimization.ps1" -Apply -CreateRestorePoint
            } else {
                Write-Host "Cancelled" -ForegroundColor Yellow
            }
        }
        
        "6" {
            Write-Host "👋 Exiting" -ForegroundColor Green
            break
        }
        
        default {
            Write-Host "❌ Invalid option. Please select 1-6" -ForegroundColor Red
        }
    }
    
    if ($choice -ne "6") {
        Write-Host "`nPress Enter to continue..."
        Read-Host
    }
    
} while ($choice -ne "6")

Write-Host "`n✅ Cleanup runner complete" -ForegroundColor Green
