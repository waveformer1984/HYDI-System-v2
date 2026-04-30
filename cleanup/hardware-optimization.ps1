# ProtoForge Hardware Optimization Script
# Optimizes system for development and security

param(
    [switch]$Apply,
    [switch]$GameMode,
    [switch]$DeveloperMode
)

Write-Host "💻 ProtoForge Hardware Optimization" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# Check administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "⚠️  Running without admin privileges. Some optimizations will be skipped." -ForegroundColor Yellow
    $isAdmin = $false
} else {
    $isAdmin = $true
}

# 1. System Information
Write-Host "`n📊 System Information:" -ForegroundColor Yellow
$systemInfo = Get-CimInstance -ClassName Win32_ComputerSystem
$osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
$cpu = Get-CimInstance -ClassName Win32_Processor
$disks = Get-CimInstance -ClassName Win32_DiskDrive

Write-Host "  Computer: $($systemInfo.Name)"
Write-Host "  OS: $($osInfo.Caption) $($osInfo.Version)"
Write-Host "  CPU: $($cpu.Name)"
Write-Host "  RAM: $([math]::Round($systemInfo.TotalPhysicalMemory / 1GB, 2)) GB"
Write-Host "  Disks:"

foreach ($disk in $disks) {
    $size = [math]::Round($disk.Size / 1GB, 2)
    $free = [math]::Round($disk.FreeSpace / 1GB, 2)
    Write-Host "    - $($disk.Model) ($size GB, $free GB free)"
}

# 2. Power Settings Optimization
Write-Host "`n⚡ Power Settings:" -ForegroundColor Yellow
if ($isAdmin) {
    $currentScheme = powercfg /getactiveguid
    Write-Host "  Current power scheme: $currentScheme"
    
    if ($Apply) {
        Write-Host "  Setting high performance mode..."
        powercfg /setactive SCHEME_MIN
        Write-Host "  Disabling sleep mode..."
        powercfg /change standby-timeout-ac 0
        powercfg /change standby-timeout-dc 0
        Write-Host "  Disabling hibernate..."
        powercfg /hibernate off
    }
} else {
    Write-Host "  ⚠️  Admin rights required to change power settings"
}

# 3. Visual Effects Optimization
Write-Host "`n🎨 Visual Effects:" -ForegroundColor Yellow
if ($isAdmin -and $Apply) {
    Write-Host "  Optimizing for performance..."
    # Set visual effects for best performance
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"
    Set-ItemProperty -Path $key -Name "VisualFXSetting" -Value 2 -Force
    
    # Disable animations
    $key = "HKCU:\Control Panel\Desktop\WindowMetrics"
    Set-ItemProperty -Path $key -Name "MinAnimate" -Value 0 -Force
    
    Write-Host "  Visual effects optimized"
}

# 4. Network Optimization
Write-Host "`n🌐 Network Optimization:" -ForegroundColor Yellow
if ($isAdmin -and $Apply) {
    # Optimize network adapter settings
    $adapters = Get-NetAdapter | Where-Object {$_.Status -eq "Up"}
    
    foreach ($adapter in $adapters) {
        Write-Host "  Optimizing adapter: $($adapter.Name)"
        
        # Disable large send offload
        Disable-NetAdapterLso -Name $adapter.Name -ErrorAction SilentlyContinue
        
        # Set DNS to fastest (Cloudflare)
        Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ServerAddresses "1.1.1.1", "1.0.0.1" -ErrorAction SilentlyContinue
    }
}

# 5. Storage Optimization
Write-Host "`n💾 Storage Optimization:" -ForegroundColor Yellow
if ($isAdmin -and $Apply) {
    Write-Host "  Running disk cleanup..."
    start-process -FilePath "cleanmgr.exe" -ArgumentList "/sagerun:1" -NoNewWindow -Wait
    
    Write-Host "  Optimizing SSD settings..."
    # Disable defragmentation schedule for SSDs
    foreach ($disk in $disks) {
        if ($disk.Model -like "*SSD*" -or $disk.MediaType -eq "Fixed hard disk media") {
            $diskLetter = (Get-Partition -DiskNumber $disk.Index | Where-Object DriveLetter).DriveLetter
            if ($diskLetter) {
                Write-Host "    Disabling defrag for drive $diskLetter"
                defrag $diskLetter /X
            }
        }
    }
    
    Write-Host "  Compacting database files..."
    compact /C /S /I
}

# 6. Memory Optimization
Write-Host "`n🧠 Memory Optimization:" -ForegroundColor Yellow
$memory = Get-Counter "\Memory\Available MBytes" -ErrorAction SilentlyContinue
if ($memory) {
    $available = $memory.CounterSamples[0].CookedValue
    $total = [math]::Round($systemInfo.TotalPhysicalMemory / 1MB, 0)
    $used = $total - $available
    $percentUsed = ($used / $total) * 100
    
    Write-Host "  Memory usage: $([math]::Round($percentUsed, 1))% ($([math]::Round($used, 0))MB used)"
    
    if ($percentUsed -gt 80) {
        Write-Host "  ⚠️  High memory usage detected!" -ForegroundColor Red
        Write-Host "  Recommendations:"
        Write-Host "    - Close unnecessary applications"
        Write-Host "    - Restart browser (Chrome can use >1GB)"
        Write-Host "    - Consider adding more RAM"
    }
}

# Clear standby memory if requested
if ($Apply -and $isAdmin) {
    Write-Host "  Clearing standby memory..."
    $process = Start-Process -FilePath "powershell" -ArgumentList "-Command", "(Get-Process).PriorityClass = 'High'; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()" -Verb RunAs -PassThru
    $process.WaitForExit()
}

# 7. Developer-Specific Optimizations
Write-Host "`n👨‍💻 Developer Optimizations:" -ForegroundColor Yellow

# Windows Subsystem for Linux
if ($Apply -and $DeveloperMode) {
    Write-Host "  Enabling WSL..."
    dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
}

# Windows Terminal
if (Test-Path "Microsoft.WindowsTerminal_8wekyb3d8bbwe") {
    Write-Host "  ✅ Windows Terminal installed"
} else {
    Write-Host "  💡 Install Windows Terminal for better terminal experience"
}

# Git optimization
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "  Optimizing Git configuration..."
    git config --global core.preloadindex true
    git config --global core.fscache true
    git config --global gc.auto 256
}

# Node.js optimization
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "  Optimizing Node.js..."
    if ($env:NODE_OPTIONS -notlike "--max-old-space-size*") {
        $env:NODE_OPTIONS = "--max-old-space-size=4096"
        [Environment]::SetEnvironmentVariable("NODE_OPTIONS", $env:NODE_OPTIONS, "User")
        Write-Host "    Set Node.js memory limit to 4GB"
    }
}

# 8. Game Mode (if requested)
if ($GameMode) {
    Write-Host "`n🎮 Enabling Game Mode..." -ForegroundColor Yellow
    if ($isAdmin -and $Apply) {
        # Enable Game Mode
        $key = "HKCU:\Software\Microsoft\GameBar"
        if (-not (Test-Path $key)) {
            New-Item -Path $key -Force | Out-Null
        }
        Set-ItemProperty -Path $key -Name "AllowAutoGameMode" -Value 1 -Force
        Set-ItemProperty -Path $key -Name "AutoGameModeEnabled" -Value 1 -Force
        
        Write-Host "  Game Mode enabled"
    }
}

# 9. Security Settings
Write-Host "`n🔒 Security Settings:" -ForegroundColor Yellow
if ($isAdmin -and $Apply) {
    Write-Host "  Enabling Windows Defender exclusions for development..."
    $pathsToAdd = @(
        "$env:USERPROFILE\Source\Repos",
        "$env:USERPROFILE\Projects",
        "$env:USERPROFILE\GitHub",
        ".\node_modules",
        ".\hydi-npm",
        ".\hydi-monitor-deploy"
    )
    
    foreach ($path in $pathsToAdd) {
        if (Test-Path $path) {
            try {
                Add-MpPreference -ExclusionPath $path -ErrorAction SilentlyContinue
                Write-Host "    Added exclusion: $path"
            } catch {
                Write-Host "    Already excluded: $path"
            }
        }
    }
    
    # Enable Controlled Folder Access exclusions
    try {
        Add-MpPreference -ControlledFolderAccessAllowedApplications "node.exe" -ErrorAction SilentlyContinue
        Add-MpPreference -ControlledFolderAccessAllowedApplications "npm.cmd" -ErrorAction SilentlyContinue
        Add-MpPreference -ControlledFolderAccessAllowedApplications "git.exe" -ErrorAction SilentlyContinue
    } catch {
        Write-Host "    Controlled Folder Access not available"
    }
}

# 10. Performance Monitor
Write-Host "`n📈 Performance Monitor:" -ForegroundColor Yellow
Write-Host "  Starting background monitoring..."

$monitorScript = {
    while ($true) {
        $cpu = Get-Counter "\Processor(_Total)\% Processor Time" -ErrorAction SilentlyContinue
        $mem = Get-Counter "\Memory\Available MBytes" -ErrorAction SilentlyContinue
        
        if ($cpu -and $mem) {
            $cpuPercent = $cpu.CounterSamples[0].CookedValue
            $memPercent = ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB - $mem.CounterSamples[0].CookedValue) / (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB * 100
            
            if ($cpuPercent -gt 90 -or $memPercent -gt 90) {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') - ⚠️ High CPU: $([math]::Round($cpuPercent, 1))% or Memory: $([math]::Round($memPercent, 1))%" -ForegroundColor Red
            }
        }
        
        Start-Sleep 30
    }
}

# Start monitoring in background
if ($Apply) {
    Start-Job -ScriptBlock $monitorScript -Name "PerformanceMonitor"
    Write-Host "  Performance monitor started (runs every 30 seconds)"
}

# 11. Generate Optimization Report
$report = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    system = @{
        cpu = $cpu.Name
        ram = [math]::Round($systemInfo.TotalPhysicalMemory / 1GB, 2)
        os = $osInfo.Caption
    }
    optimizations = @()
    recommendations = @()
}

if ($Apply) {
    $report.optimizations += "Power settings optimized"
    $report.optimizations += "Network settings optimized"
    $report.optimizations += "Storage optimized"
}

if ($memory -and $memory.CounterSamples[0].CookedValue -lt 1024) {
    $report.recommendations += "Low available memory - consider adding RAM"
}

if ($GameMode) {
    $report.optimizations += "Game Mode enabled"
}

$report | ConvertTo-Json | Out-File "cleanup\hardware-optimization-report.json" -Encoding UTF8

Write-Host "`n✅ Hardware optimization complete!" -ForegroundColor Green
Write-Host "📊 Report saved to: cleanup\hardware-optimization-report.json"

if (-not $Apply) {
    Write-Host "`n💡 Run with -Apply flag to apply optimizations" -ForegroundColor Cyan
    Write-Host "   Example: .\hardware-optimization.ps1 -Apply" -ForegroundColor Cyan
}
