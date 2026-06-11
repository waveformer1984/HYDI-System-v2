# heidi-firewall.ps1
# Run once as Administrator to open port 5050 for Heidi Bridge
# Right-click PowerShell -> "Run as Administrator", then:
#   Set-ExecutionPolicy RemoteSigned -Scope Process
#   .\heidi-firewall.ps1

$ruleName  = "Heidi Bridge"
$port      = 5050
$proto     = "TCP"

# Remove old rule if it exists
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleName
    Write-Host "Removed old rule: $ruleName"
}

# Add inbound rule
New-NetFirewallRule `
    -DisplayName  $ruleName `
    -Direction    Inbound `
    -Protocol     $proto `
    -LocalPort    $port `
    -Action       Allow `
    -Profile      Private,Domain `
    -Description  "Allows Heidi mobile (Android/Termux) to reach heidi-bridge.py on this PC" | Out-Null

Write-Host ""
Write-Host "Firewall rule created: '$ruleName' — port $port/$proto (Inbound, Private/Domain)"
Write-Host ""
Write-Host "Verify with:"
Write-Host "  Get-NetFirewallRule -DisplayName '$ruleName' | Format-List"
Write-Host ""
Write-Host "Test from Android (after bridge is running):"
Write-Host "  curl http://192.168.86.82:5050/health"
