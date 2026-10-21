# Run on Frank (Windows) in an elevated PowerShell.
# Listens for Ollama on the LAN, only from the local subnet, and pulls qwen2.5:3b.
# Idempotent. Does not open TCP 11434 on Public networks.
# -Tailscale additionally allows TCP 11434 and 3000 inbound only from the
# Tailscale CGNAT range (100.64.0.0/10), so the phone can reach Frank off-LAN.
#Requires -RunAsAdministrator
param(
    [switch]$Tailscale
)
$ErrorActionPreference = 'Stop'

$listen = '0.0.0.0:11434'
$ruleName = 'HYDI-Ollama-LAN-11434'

[Environment]::SetEnvironmentVariable('OLLAMA_HOST', $listen, 'User')
Write-Output "OLLAMA_HOST user env = $listen"

$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Remove-NetFirewallRule -Name $ruleName
}
New-NetFirewallRule `
    -Name $ruleName `
    -DisplayName 'Ollama LAN TCP 11434 (local subnet only)' `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Domain, Private `
    -Protocol TCP `
    -LocalPort 11434 `
    -RemoteAddress LocalSubnet | Out-Null
Write-Output "Firewall rule $ruleName allows TCP 11434 from LocalSubnet on Domain and Private profiles only."

if ($Tailscale) {
    $tailscaleRules = @(
        @{ Name = 'HYDI-Ollama-Tailscale-11434'; Port = 11434; Display = 'Ollama TCP 11434 (Tailscale 100.64.0.0/10 only)' },
        @{ Name = 'HYDI-Board-Tailscale-3000'; Port = 3000; Display = 'HYDI board TCP 3000 (Tailscale 100.64.0.0/10 only)' }
    )
    foreach ($tsRule in $tailscaleRules) {
        if (Get-NetFirewallRule -Name $tsRule.Name -ErrorAction SilentlyContinue) {
            Remove-NetFirewallRule -Name $tsRule.Name
        }
        New-NetFirewallRule `
            -Name $tsRule.Name `
            -DisplayName $tsRule.Display `
            -Direction Inbound `
            -Action Allow `
            -Enabled True `
            -Profile Any `
            -Protocol TCP `
            -LocalPort $tsRule.Port `
            -RemoteAddress '100.64.0.0/10' | Out-Null
        Write-Output "Firewall rule $($tsRule.Name) allows TCP $($tsRule.Port) from 100.64.0.0/10 only."
    }
}

$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
)
$ollama = $null
foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) {
        $ollama = $path
        break
    }
}
if (-not $ollama) {
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { $ollama = $cmd.Source }
}
if (-not $ollama) {
    Write-Output 'Ollama is not installed. Install it from https://ollama.com/download and run this script again.'
    exit 1
}

Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(ollama|ollama app)$' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$env:OLLAMA_HOST = $listen
Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden
Write-Output "Started $ollama serve"

$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    try {
        Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
if (-not $ready) {
    Write-Output 'Ollama did not answer http://127.0.0.1:11434/api/tags'
    exit 1
}

$env:OLLAMA_HOST = '127.0.0.1:11434'
& $ollama pull qwen2.5:3b
if ($LASTEXITCODE -ne 0) {
    Write-Output 'ollama pull qwen2.5:3b failed'
    exit 1
}

Write-Output 'LAN IPv4 addresses to use as FRANK_IP on the phone:'
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -ne 'WellKnown'
    } |
    ForEach-Object { Write-Output ("  " + $_.IPAddress) }
