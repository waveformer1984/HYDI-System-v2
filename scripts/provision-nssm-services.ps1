#!/usr/bin/env pwsh
<#
.SYNOPSIS
NSSM (Non-Sucking Service Manager) Provisioning for Hydi System

.DESCRIPTION
Migrates Hydi services from PM2 user-space to native Windows Services.
Registers HYDI_Orchestrator and HYDI_Dashboard with:
  - Delayed startup (SERVICE_DELAYED_START)
  - Persistent failure recovery (auto-restart with configurable delays)
  - Dependency chains (Dashboard depends on Orchestrator)
  - Log streaming to persistent JSON files

.PREREQUISITES
- NSSM must be installed: https://nssm.cc/download
- Run as Administrator
- Execution policy: powershell -ExecutionPolicy Bypass -File provision-nssm-services.ps1

.NOTES
Validation Gate 3:
  1. Run: npx pm2 kill (terminate user-space execution)
  2. Restart Windows completely
  3. Log in as different user
  4. Navigate to: http://localhost:3007 (Ursula Dashboard)
  5. Verify telemetry streams are live and synchronized

.VERSION
1.0
#>

param(
    [string]$NSSMPath = "C:\nssm\nssm.exe",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$HydiSystemPath = "F:\HYDI_System",
    [string]$ServiceUser = "SVC_HYDICore",
    [string]$ServicePassword = "Change_Me_2026!",
    [int]$DashboardPort = 3007
)

function Test-ElevatedPrivileges {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-NSSM {
    if (-not (Test-Path $NSSMPath)) {
        Write-Host "✗ NSSM not found at: $NSSMPath" -ForegroundColor Red
        Write-Host "  Download from: https://nssm.cc/download" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "✓ NSSM found at: $NSSMPath`n" -ForegroundColor Green
}

function Create-ServiceUser {
    <#
    .SYNOPSIS
    Create local service account if it doesn't exist.
    #>
    param([string]$Username, [string]$Password)

    $userExists = $null -ne (Get-LocalUser -Name $Username -ErrorAction SilentlyContinue)

    if ($userExists) {
        Write-Host "✓ Service user already exists: $Username" -ForegroundColor Green
        return
    }

    Write-Host "Creating service user: $Username" -ForegroundColor Yellow

    $securePassword = ConvertTo-SecureString $Password -AsPlainText -Force
    New-LocalUser -Name $Username -Password $securePassword -Description "HYDI Core Services Account" -UserMayNotChangePassword -PasswordNeverExpires
    Write-Host "✓ Service user created`n" -ForegroundColor Green
}

function Register-HYDIOrchestrator {
    <#
    .SYNOPSIS
    Register HYDI_Orchestrator service via NSSM.
    #>
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║    Registering: HYDI_Orchestrator Service              ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    $serviceName = "HYDI_Orchestrator"
    $appPath = "$HydiSystemPath\hydi-orchestrator.js"

    # Check if service already exists
    $serviceExists = $null -ne (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
    if ($serviceExists) {
        Write-Host "⚠️  Service already exists. Removing for reconfiguration..." -ForegroundColor Yellow
        & $NSSMPath remove $serviceName confirm
        Start-Sleep -Seconds 2
    }

    # Install service
    Write-Host "Installing service: $serviceName" -ForegroundColor Cyan
    & $NSSMPath install $serviceName $NodePath $appPath

    # Configure app directory
    & $NSSMPath set $serviceName AppDirectory $HydiSystemPath
    Write-Host "  ✓ AppDirectory: $HydiSystemPath" -ForegroundColor Green

    # Configure service account
    & $NSSMPath set $serviceName ObjectName ".\$ServiceUser" $ServicePassword
    Write-Host "  ✓ ObjectName: $ServiceUser" -ForegroundColor Green

    # Delayed startup
    & $NSSMPath set $serviceName Start SERVICE_DELAYED_START
    Write-Host "  ✓ Startup: Delayed" -ForegroundColor Green

    # Failure recovery settings
    & $NSSMPath set $serviceName AppThrottle 1500
    & $NSSMPath set $serviceName AppExit Default Restart
    & $NSSMPath set $serviceName AppRestartDelay 5000
    Write-Host "  ✓ Restart: Auto-restart after 5000ms on exit" -ForegroundColor Green

    # Log configuration
    $logsDir = "$HydiSystemPath\logs"
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    }

    & $NSSMPath set $serviceName AppStdout "$logsDir\orchestrator_stdout.log"
    & $NSSMPath set $serviceName AppStderr "$logsDir\orchestrator_stderr.log"
    Write-Host "  ✓ Logs: $logsDir\orchestrator_*.log" -ForegroundColor Green

    Write-Host "`n✓ Service registered: $serviceName`n" -ForegroundColor Green
}

function Register-HYDIDashboard {
    <#
    .SYNOPSIS
    Register HYDI_Dashboard service via NSSM.
    #>
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║    Registering: HYDI_Dashboard Service                ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    $serviceName = "HYDI_Dashboard"
    $appPath = "$HydiSystemPath\ursula-dashboard-enhanced.js"

    # Set environment variable for port
    $env:DASHBOARD_PORT = $DashboardPort

    # Check if service already exists
    $serviceExists = $null -ne (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
    if ($serviceExists) {
        Write-Host "⚠️  Service already exists. Removing for reconfiguration..." -ForegroundColor Yellow
        & $NSSMPath remove $serviceName confirm
        Start-Sleep -Seconds 2
    }

    # Install service
    Write-Host "Installing service: $serviceName" -ForegroundColor Cyan
    & $NSSMPath install $serviceName $NodePath $appPath

    # Configure app directory
    & $NSSMPath set $serviceName AppDirectory $HydiSystemPath
    Write-Host "  ✓ AppDirectory: $HydiSystemPath" -ForegroundColor Green

    # Configure service account
    & $NSSMPath set $serviceName ObjectName ".\$ServiceUser" $ServicePassword
    Write-Host "  ✓ ObjectName: $ServiceUser" -ForegroundColor Green

    # Delayed startup
    & $NSSMPath set $serviceName Start SERVICE_DELAYED_START
    Write-Host "  ✓ Startup: Delayed" -ForegroundColor Green

    # Environment variables
    & $NSSMPath set $serviceName AppEnvironmentExtra "DASHBOARD_PORT=$DashboardPort"
    Write-Host "  ✓ Environment: DASHBOARD_PORT=$DashboardPort" -ForegroundColor Green

    # Failure recovery
    & $NSSMPath set $serviceName AppThrottle 1500
    & $NSSMPath set $serviceName AppExit Default Restart
    & $NSSMPath set $serviceName AppRestartDelay 5000
    Write-Host "  ✓ Restart: Auto-restart after 5000ms on exit" -ForegroundColor Green

    # Log configuration
    $logsDir = "$HydiSystemPath\logs"
    & $NSSMPath set $serviceName AppStdout "$logsDir\dashboard_stdout.log"
    & $NSSMPath set $serviceName AppStderr "$logsDir\dashboard_stderr.log"
    Write-Host "  ✓ Logs: $logsDir\dashboard_*.log" -ForegroundColor Green

    Write-Host "`n✓ Service registered: $serviceName`n" -ForegroundColor Green
}

function Configure-ServiceDependencies {
    <#
    .SYNOPSIS
    Set service dependency: Dashboard depends on Orchestrator.
    #>
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║         Configuring Service Dependencies              ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    Write-Host "Setting dependency: HYDI_Dashboard → Redis, HYDI_Orchestrator" -ForegroundColor Yellow

    # Dashboard depends on Orchestrator
    & sc.exe config HYDI_Dashboard depend= Redis/HYDI_Orchestrator
    Write-Host "  ✓ HYDI_Dashboard depends on: Redis, HYDI_Orchestrator" -ForegroundColor Green

    # Orchestrator depends on Redis
    & sc.exe config HYDI_Orchestrator depend= Redis
    Write-Host "  ✓ HYDI_Orchestrator depends on: Redis" -ForegroundColor Green

    Write-Host ""
}

function Show-Summary {
    <#
    .SYNOPSIS
    Display service configuration summary and next steps.
    #>
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║           PROVISIONING COMPLETE - SUMMARY              ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    Write-Host "Services Registered:" -ForegroundColor Green
    Write-Host "  ✓ HYDI_Orchestrator - Core orchestration service"
    Write-Host "  ✓ HYDI_Dashboard    - Ursula dashboard (port: $DashboardPort)"
    Write-Host ""

    Write-Host "Service Account:" -ForegroundColor Green
    Write-Host "  ✓ User: $ServiceUser"
    Write-Host "  ✓ Password: (configured in registry)"
    Write-Host ""

    Write-Host "Startup Configuration:" -ForegroundColor Green
    Write-Host "  ✓ Type: Delayed Start (SERVICE_DELAYED_START)"
    Write-Host "  ✓ Failure Recovery: Auto-restart after 5 seconds"
    Write-Host "  ✓ Dependencies: Dashboard → Orchestrator → Redis"
    Write-Host ""

    Write-Host "Log Locations:" -ForegroundColor Green
    Write-Host "  ✓ Orchestrator: F:\HYDI_System\logs\orchestrator_*.log"
    Write-Host "  ✓ Dashboard:    F:\HYDI_System\logs\dashboard_*.log"
    Write-Host ""

    Write-Host "Verification Steps:" -ForegroundColor Cyan
    Write-Host "  1. Kill PM2 user-space: npx pm2 kill"
    Write-Host "  2. Restart Windows: shutdown /r /t 0"
    Write-Host "  3. Log in as different user account"
    Write-Host "  4. Verify services started: Get-Service HYDI_* | Select Name, Status"
    Write-Host "  5. Access dashboard: http://localhost:$DashboardPort"
    Write-Host "  6. Check logs: tail -f F:\HYDI_System\logs\*.log"
    Write-Host ""

    Write-Host "Service Management Commands:" -ForegroundColor Yellow
    Write-Host "  Start service:   Start-Service HYDI_Orchestrator"
    Write-Host "  Stop service:    Stop-Service HYDI_Orchestrator"
    Write-Host "  Check status:    Get-Service HYDI_*"
    Write-Host "  View logs:       Get-Content F:\HYDI_System\logs\orchestrator_stdout.log -Tail 50 -Wait"
    Write-Host ""
}

function main {
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║   HYDI SYSTEM: NSSM SERVICE PROVISIONING              ║" -ForegroundColor Cyan
    Write-Host "║   Migration from PM2 (user-space) to Windows Services  ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # Privilege check
    if (-not (Test-ElevatedPrivileges)) {
        Write-Host "✗ ERROR: This script requires Administrator privileges." -ForegroundColor Red
        Write-Host "  Run as: powershell -ExecutionPolicy Bypass -File provision-nssm-services.ps1" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "✓ Running with Administrator privileges`n" -ForegroundColor Green

    # NSSM check
    Test-NSSM

    # Create service user
    Create-ServiceUser -Username $ServiceUser -Password $ServicePassword

    # Register services
    Register-HYDIOrchestrator
    Register-HYDIDashboard

    # Configure dependencies
    Configure-ServiceDependencies

    # Show summary
    Show-Summary
}

# Execute
main
