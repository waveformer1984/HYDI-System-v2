#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Opens TCP 6379 (Redis) on the Private network profile for LocalSubnet sources only.
  Run once from an elevated PowerShell window.

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\enable-redis-lan-firewall.ps1
#>

$ruleName = 'HYDI Master Broker Stream Ingress'

# Idempotent: remove any existing rule with this name first
if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $ruleName
    Write-Host "Removed existing rule '$ruleName'"
}

New-NetFirewallRule `
    -DisplayName  $ruleName `
    -Description  'Allows edge mesh nodes on the local subnet to connect to Redis for HYDI task routing' `
    -Direction    Inbound `
    -Action       Allow `
    -Protocol     TCP `
    -LocalPort    6379 `
    -RemoteAddress 'LocalSubnet' `
    -Profile      Private `
    -Enabled      True

Write-Host "`n[HYDI] Firewall rule '$ruleName' created."
Write-Host "[HYDI] Redis (port 6379) is now reachable from LAN devices on the Private profile."
Write-Host "[HYDI] Verify with: Get-NetFirewallRule -DisplayName '$ruleName'"
