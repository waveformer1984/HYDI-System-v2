#!/usr/bin/env pwsh
<#
.SYNOPSIS
HYDI Process Hard Affinity Control Configuration

.DESCRIPTION
Partitions Hydi system processes across CPU cores:
- P-Cores (0-7):   Primary workloads (ProtoForge, orchestrator)
- E-Cores (8-15):  Telemetry, logging, dashboard

Assumes standard modern architecture with 8 Performance Cores (P-Cores)
and 8 Efficiency Cores (E-Cores), totaling 16 logical processors.

.NOTES
- Requires elevated Administrator privileges
- Must run with execution policy bypass: pwsh -ExecutionPolicy Bypass -File ...
- Changes are process-specific and do not survive reboot
- For persistent assignment, integrate into system startup

.AUTHOR
HYDI Infrastructure Team

.VERSION
1.0
#>

# ─────────────────────────────────────────────────────────────────
# CPU Affinity Mask Reference
# ─────────────────────────────────────────────────────────────────
# P-Cores:  0-7   = Cores 0-7   = Mask: 0xFF = 255 (binary: 00000000000011111111)
# E-Cores:  8-15  = Cores 8-15  = Mask: 0xFF00 = 65280 (binary: 1111111100000000)

$PCoresMask = 0xFF          # Cores 0-7:  255
$ECoresMask = 0xFF00        # Cores 8-15: 65280

function Test-ElevatedPrivileges {
    <#
    .SYNOPSIS
    Verify script is running with administrator privileges.
    #>
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-HYDIProcessAffinity {
    <#
    .SYNOPSIS
    Set CPU affinity and priority for HYDI processes.

    .PARAMETER ProcessName
    Name of process to configure (e.g., "node", "redis-server")

    .PARAMETER PriorityClass
    Process priority: Low, BelowNormal, Normal, AboveNormal, High, Realtime

    .PARAMETER CpuAffinityMask
    Bitmask for CPU cores (e.g., 255 for cores 0-7)
    #>
    param(
        [string]$ProcessName,
        [string]$PriorityClass,
        [int64]$CpuAffinityMask
    )

    Write-Host "⏳ Configuring: $ProcessName" -ForegroundColor Cyan

    $targetProcesses = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue

    if ($null -eq $targetProcesses) {
        Write-Host "  ⚠️  Process not found: $ProcessName" -ForegroundColor Yellow
        return
    }

    $count = 0
    foreach ($proc in $targetProcesses) {
        try {
            # Set priority class
            $proc.PriorityClass = $PriorityClass

            # Set CPU affinity
            $proc.ProcessorAffinity = $CpuAffinityMask

            # Decode mask for display
            $maskBinary = [Convert]::ToString($CpuAffinityMask, 2).PadLeft(16, '0')
            $coreList = @()
            for ($i = 0; $i -lt 16; $i++) {
                if ($maskBinary[15 - $i] -eq '1') {
                    $coreList += $i
                }
            }

            Write-Host "  ✓ PID: $($proc.Id) | Priority: $PriorityClass | Cores: [$($coreList -join ', ')]" `
                -ForegroundColor Green
            $count++
        }
        catch {
            Write-Host "  ✗ Failed to configure PID $($proc.Id): $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-Host "  Configured: $count process(es)`n" -ForegroundColor Green
}

function Get-AffinityMaskForCores {
    <#
    .SYNOPSIS
    Convert core numbers to affinity bitmask.

    .PARAMETER Cores
    Array of core indices (0-15)

    .EXAMPLE
    Get-AffinityMaskForCores @(0, 1, 2, 3)  # Returns 15 (0xF)
    #>
    param([int[]]$Cores)

    $mask = 0
    foreach ($core in $Cores) {
        $mask += [math]::Pow(2, $core)
    }
    return [int64]$mask
}

function Show-CpuArchitecture {
    <#
    .SYNOPSIS
    Display system CPU information and architecture.
    #>
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║         CPU ARCHITECTURE INFORMATION                   ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    $processorInfo = Get-WmiObject Win32_Processor
    Write-Host "Processor:     $($processorInfo.Name)"
    Write-Host "Cores:         $($processorInfo.NumberOfCores)"
    Write-Host "Logical CPUs:  $($processorInfo.NumberOfLogicalProcessors)"
    Write-Host ""
    Write-Host "Assumed Layout:"
    Write-Host "  P-Cores:  0-7   (Mask: 0xFF = 255)"
    Write-Host "  E-Cores:  8-15  (Mask: 0xFF00 = 65280)"
    Write-Host ""
}

function main {
    # ─────────────────────────────────────────────────────────────────
    # Privilege Check
    # ─────────────────────────────────────────────────────────────────
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║    HYDI PROCESS AFFINITY CONTROL PROVISIONING         ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-ElevatedPrivileges)) {
        Write-Host "✗ ERROR: This script requires Administrator privileges." -ForegroundColor Red
        Write-Host "  Run as: powershell -ExecutionPolicy Bypass -File set-affinity-policies.ps1" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "✓ Running with Administrator privileges`n" -ForegroundColor Green

    # ─────────────────────────────────────────────────────────────────
    # Display Architecture
    # ─────────────────────────────────────────────────────────────────
    Show-CpuArchitecture

    # ─────────────────────────────────────────────────────────────────
    # Apply Affinity Policies
    # ─────────────────────────────────────────────────────────────────
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║         APPLYING AFFINITY POLICIES                     ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # Policy 1: Telemetry/Logging to E-Cores (Below Normal priority)
    Write-Host "[1/3] Telemetry & Logging (E-Cores 8-15)" -ForegroundColor Cyan
    Set-HYDIProcessAffinity -ProcessName "node" -PriorityClass "BelowNormal" -CpuAffinityMask $ECoresMask

    # Policy 2: Database and primary infrastructure (P-Cores, High priority)
    Write-Host "[2/3] Redis Database Engine (P-Cores 0-7)" -ForegroundColor Cyan
    Set-HYDIProcessAffinity -ProcessName "redis-server" -PriorityClass "High" -CpuAffinityMask $PCoresMask

    # Policy 3: Primary workloads (Protoforge, Orchestrator) - P-Cores, High
    Write-Host "[3/3] Primary Workloads (P-Cores 0-7)" -ForegroundColor Cyan
    # Note: If Protoforge or orchestrator are under distinct process names, configure separately:
    # Set-HYDIProcessAffinity -ProcessName "protoforge" -PriorityClass "High" -CpuAffinityMask $PCoresMask
    # Set-HYDIProcessAffinity -ProcessName "hydi-orchestrator" -PriorityClass "High" -CpuAffinityMask $PCoresMask

    # ─────────────────────────────────────────────────────────────────
    # Summary Report
    # ─────────────────────────────────────────────────────────────────
    Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║         AFFINITY POLICY CONFIGURATION COMPLETE         ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "Summary:" -ForegroundColor Green
    Write-Host "  ✓ Node.js processes  → E-Cores (8-15), Below Normal priority"
    Write-Host "  ✓ Redis server       → P-Cores (0-7), High priority"
    Write-Host ""

    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Monitor thermal behavior with: Get-Process | Select ProcessName, Handles, CPU"
    Write-Host "  2. Verify no UI freezing during heavy ProtoForge workloads"
    Write-Host "  3. Run ThermalMitigationGuard to verify thermal bounds"
    Write-Host ""

    Write-Host "To verify current assignments:" -ForegroundColor Yellow
    Write-Host "  Get-Process node | Select Id, ProcessorAffinity, PriorityClass"
    Write-Host ""
}

# Execute main
main
