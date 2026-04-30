# HID Agent Runner
# Secure key setup and rotation

param(
    [string]$Action = "setup",
    [switch]$Auto,
    [switch]$Verify
)

Write-Host "🤖 HID Agent - Secure Key Management" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

# Check if we're in HYDI_System
$currentDir = Get-Location
if (-not ($currentDir.Path -like "*HYDI_System*")) {
    Write-Host "ERROR: Not in HYDI_System directory" -ForegroundColor Red
    exit 1
}

# Create HID directory if needed
if (-not (Test-Path "agents\hid")) {
    New-Item -ItemType Directory -Path "agents\hid" -Force | Out-Null
}

switch ($Action) {
    "setup" {
        Write-Host "`n🔐 Running secure key setup..." -ForegroundColor Yellow
        node agents\hid\secure-key-setup.js
    }
    
    "rotate" {
        Write-Host "`n🔄 Running key rotation..." -ForegroundColor Yellow
        node agents\hid\key-rotation-agent.js
    }
    
    "verify" {
        Write-Host "`n🔍 Verifying current setup..." -ForegroundColor Yellow
        node agents\hid\secure-key-setup.js
    }
    
    "auto" {
        if ($Auto) {
            Write-Host "`n⚡ Running automated rotation..." -ForegroundColor Yellow
            node agents\hid\key-rotation-agent.js
        } else {
            Write-Host "Use -Auto flag for automated rotation" -ForegroundColor Yellow
        }
    }
    
    default {
        Write-Host "`nUsage:" -ForegroundColor Cyan
        Write-Host "  .\run-hid-setup.ps1 -Action setup    # Interactive setup"
        Write-Host "  .\run-hid-setup.ps1 -Action rotate    # Automated rotation"
        Write-Host "  .\run-hid-setup.ps1 -Action verify    # Verify current setup"
        Write-Host "  .\run-hid-setup.ps1 -Action auto -Auto # Fully automated"
    }
}

Write-Host "`n✅ HID agent operation complete" -ForegroundColor Green
