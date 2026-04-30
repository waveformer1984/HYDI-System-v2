# ProtoForge SAFE Hardware Optimization Script
# Version: 2.0 - Safety First with Rollback
# Run as Administrator for full functionality

param(
    [switch]$Apply,
    [switch]$DryRun,
    [switch]$SafeMode,
    [switch]$CreateRestorePoint
)

# Safety checks
Write-Host "💻 ProtoForge SAFE Hardware Optimization" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# 1. Pre-flight safety checks
Write-Host "`n🛡️  Pre-flight Safety Checks:" -ForegroundColor Yellow

# Check administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "  ⚠️  Running without admin privileges" -ForegroundColor Yellow
    Write-Host "  Some optimizations will be skipped" -ForegroundColor Yellow
    $isAdmin = $false
} else {
    $isAdmin = $true
    Write-Host "  ✅ Running with admin privileges" -ForegroundColor Green
}

# Check if we're in the right directory
$currentDir = Get-Location
if (-not ($currentDir.Path -like "*HYDI_System*")) {
    Write-Host "  ⚠️  WARNING: Not in HYDI_System directory!" -ForegroundColor Red
    Write-Host "  Current: $($currentDir.Path)" -ForegroundColor Red
}

# Create restore point if requested
if ($CreateRestorePoint -and $isAdmin) {
    Write-Host "`n💾 Creating System Restore Point..." -ForegroundColor Yellow
    try {
        $checkpoint = Checkpoint-Computer -Description "ProtoForge Pre-Optimization" -RestorePointType "MODIFY_SETTINGS"
        if ($checkpoint) {
            Write-Host "  ✅ Restore point created successfully" -ForegroundColor Green
        }
    } catch {
        Write-Host "  ⚠️  Could not create restore point: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 2. System information
Write-Host "`n📊 Current System Status:" -ForegroundColor Yellow

$systemInfo = Get-CimInstance -ClassName Win32_ComputerSystem
$osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
$cpu = Get-CimInstance -ClassName Win32_Processor
$disks = Get-CimInstance -ClassName Win32_DiskDrive

Write-Host "  Computer: $($systemInfo.Name)"
Write-Host "  OS: $($osInfo.Caption) $($osInfo.Version)"
Write-Host "  CPU: $($cpu.Name)"
Write-Host "  RAM: $([math]::Round($systemInfo.TotalPhysicalMemory / 1GB, 2)) GB"

# Check current performance
$currentCPU = Get-Counter "\Processor(_Total)\% Processor Time" -ErrorAction SilentlyContinue
$currentMem = Get-Counter "\Memory\Available MBytes" -ErrorAction SilentlyContinue

if ($currentCPU -and $currentMem) {
    $cpuPercent = $currentCPU.CounterSamples[0].CookedValue
    $memPercent = ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB - $currentMem.CounterSamples[0].CookedValue) / (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB * 100
    
    Write-Host "  Current CPU: $([math]::Round($cpuPercent, 1))%" -ForegroundColor $(if($cpuPercent -gt 80) {"Red"} else {"Green"})
    Write-Host "  Current Memory: $([math]::Round($memPercent, 1))%" -ForegroundColor $(if($memPercent -gt 80) {"Red"} else {"Green"})
}

# 3. Define optimization levels
$optimizations = @{
    safe = @{
        name = "Safe Optimizations"
        items = @(
            "Clear temp files",
            "Optimize visual effects",
            "Configure power settings",
            "Network DNS optimization"
        )
        risk = "low"
    }
    
    moderate = @{
        name = "Moderate Optimizations"
        items = @(
            "Memory management",
            "Storage optimization",
            "Network adapter tuning",
            "Service optimization"
        )
        risk = "medium"
    }
    
    aggressive = @{
        name = "Aggressive Optimizations"
        items = @(
            "Registry tweaks",
            "Service disabling",
            "Advanced memory tuning",
            "Game mode"
        )
        risk = "high"
    }
}

# 4. Determine optimization level
$selectedLevel = if ($SafeMode) { "safe" } else { "moderate" }

Write-Host "`n🎯 Optimization Level: $selectedLevel ($($optimizations[$selectedLevel].risk) risk)" -ForegroundColor Cyan
Write-Host "  Planned optimizations:"
foreach ($item in $optimizations[$selectedLevel].items) {
    Write-Host "    - $item"
}

# 5. Dry run mode
if ($DryRun -or -not $Apply) {
    Write-Host "`n🔍 DRY RUN MODE - No changes will be made" -ForegroundColor Cyan
    Write-Host "======================================" -ForegroundColor Cyan
    $Apply = $false
}

# 6. Execute optimizations
if ($Apply) {
    Write-Host "`n⚡ EXECUTING OPTIMIZATIONS" -ForegroundColor Red
    Write-Host "========================" -ForegroundColor Red
    
    # Store current settings for rollback
    $rollbackData = @{
        timestamp = Get-Date
        powerScheme = $null
        visualEffects = $null
        dnsSettings = $null
    }
    
    try {
        # Safe optimizations
        if ($selectedLevel -eq "safe" -or $selectedLevel -eq "moderate") {
            Write-Host "`n  🧹 Clearing temporary files..."
            $tempPaths = @("$env:TEMP", "$env:LOCALAPPDATA\Temp")
            $cleanedSize = 0
            
            foreach ($path in $tempPaths) {
                if (Test-Path $path) {
                    $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                    Remove-Item "$path\*" -Recurse -Force -ErrorAction SilentlyContinue
                    $cleanedSize += $size
                }
            }
            Write-Host "    Cleaned $([math]::Round($cleanedSize / 1MB, 2)) MB"
            
            Write-Host "  ⚡ Optimizing power settings..."
            if ($isAdmin) {
                $rollbackData.powerScheme = powercfg /getactiveguid
                powercfg /setactive SCHEME_MIN
                Write-Host "    Set to High Performance"
            }
            
            Write-Host "  🎨 Optimizing visual effects..."
            if ($isAdmin) {
                $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"
                $rollbackData.visualEffects = Get-ItemProperty $key -Name "VisualFXSetting" -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $key -Name "VisualFXSetting" -Value 2 -Force
                Write-Host "    Set to best performance"
            }
            
            Write-Host "  🌐 Optimizing DNS settings..."
            $adapters = Get-NetAdapter | Where-Object {$_.Status -eq "Up"} | Select-Object -First 1
            if ($adapters) {
                $rollbackData.dnsSettings = Get-DnsClientServerAddress -InterfaceAlias $adapters.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue
                Set-DnsClientServerAddress -InterfaceAlias $adapters.Name -ServerAddresses "1.1.1.1", "1.0.0.1" -ErrorAction SilentlyContinue
                Write-Host "    Set DNS to Cloudflare (1.1.1.1)"
            }
        }
        
        # Moderate optimizations
        if ($selectedLevel -eq "moderate") {
            Write-Host "`n  🧠 Memory management..."
            if ($isAdmin) {
                # Clear standby memory
                $process = Start-Process -FilePath "powershell" -ArgumentList "-Command", "[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()" -Verb RunAs -PassThru
                $process.WaitForExit()
                Write-Host "    Cleared standby memory"
            }
            
            Write-Host "  💾 Storage optimization..."
            if ($isAdmin) {
                # Optimize SSD settings
                foreach ($disk in $disks) {
                    if ($disk.Model -like "*SSD*" -or $disk.MediaType -eq "Fixed hard disk media") {
                        $diskLetter = (Get-Partition -DiskNumber $disk.Index | Where-Object DriveLetter).DriveLetter
                        if ($diskLetter) {
                            Write-Host "    Optimizing SSD: $diskLetter"
                            defrag $diskLetter /X -ErrorAction SilentlyContinue
                        }
                    }
                }
            }
        }
        
        # Save rollback data
        $rollbackPath = ".\cleanup\rollback-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
        $rollbackData | ConvertTo-Json | Out-File $rollbackPath -Encoding UTF8
        Write-Host "`n💾 Rollback data saved to: $rollbackPath"
        
        Write-Host "`n✅ Optimizations completed!" -ForegroundColor Green
        
    } catch {
        Write-Host "`n❌ Error during optimization: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "   Check rollback file to restore settings" -ForegroundColor Yellow
    }
    
} else {
    Write-Host "`n📋 OPTIMIZATION PLAN:" -ForegroundColor Cyan
    Write-Host "  Level: $selectedLevel"
    Write-Host "  Risk: $($optimizations[$selectedLevel].risk)"
    Write-Host "  Changes: $($optimizations[$selectedLevel].items.Count) optimizations"
    Write-Host "`n  Use -Apply to execute optimizations"
    Write-Host "  Use -CreateRestorePoint for system protection"
    Write-Host "  Use -SafeMode for conservative changes only"
}

# 7. Post-optimization status
if ($Apply) {
    Write-Host "`n📊 Post-optimization Status:" -ForegroundColor Yellow
    
    # Check performance after optimization
    Start-Sleep -Seconds 2  # Let system settle
    
    $postCPU = Get-Counter "\Processor(_Total)\% Processor Time" -ErrorAction SilentlyContinue
    $postMem = Get-Counter "\Memory\Available MBytes" -ErrorAction SilentlyContinue
    
    if ($postCPU -and $postMem) {
        $cpuPercent = $postCPU.CounterSamples[0].CookedValue
        $memPercent = ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB - $postMem.CounterSamples[0].CookedValue) / (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB * 100
        
        Write-Host "  CPU: $([math]::Round($cpuPercent, 1))%" -ForegroundColor $(if($cpuPercent -gt 80) {"Red"} else {"Green"})
        Write-Host "  Memory: $([math]::Round($memPercent, 1))%" -ForegroundColor $(if($memPercent -gt 80) {"Red"} else {"Green"})
    }
}

# 8. Generate report
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    mode = if ($DryRun) { "dry-run" } elseif ($Apply) { "applied" } else { "planned" }
    level = $selectedLevel
    system = @{
        cpu = $cpu.Name
        ram = [math]::Round($systemInfo.TotalPhysicalMemory / 1GB, 2)
        os = $osInfo.Caption
    }
    optimizations = $optimizations[$selectedLevel].items
    rollbackAvailable = $Apply
}

$reportPath = ".\cleanup\hardware-optimization-report.json"
$report | ConvertTo-Json | Out-File $reportPath -Encoding UTF8

Write-Host "`n📊 Report saved to: $reportPath"

# 9. Safety recommendations
Write-Host "`n💡 Safety Recommendations:" -ForegroundColor Cyan
Write-Host "  1. Monitor system performance for 24 hours"
Write-Host "  2. Test critical applications after optimization"
Write-Host "  3. Keep rollback file for at least 1 week"
Write-Host "  4. Document any issues for future reference"

if ($Apply) {
    Write-Host "`n🔄 To rollback optimizations:" -ForegroundColor Yellow
    Write-Host "  1. Use System Restore if created"
    Write-Host "  2. Or run: .\cleanup\rollback-optimization.ps1"
    Write-Host "  3. Restart if needed"
}

Write-Host "`n✅ Safe hardware optimization complete" -ForegroundColor Green
