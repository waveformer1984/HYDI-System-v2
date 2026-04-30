#!/usr/bin/env pwsh
<#
.SYNOPSIS
    HID Agent Setup Runner - Interactive credential collection
.DESCRIPTION
    Prompts for Stripe and Vercel credentials, creates task config, runs safety orchestrator
#>

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  HID AGENT - WEBHOOK SETUP" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "This will use USB HID to automate Stripe and Vercel setup.`n" -ForegroundColor Yellow

# Check for kill switch
$killSwitch = "C:\tmp\STOP_HID"
if (Test-Path $killSwitch) {
    Write-Host "`n🛑 KILL SWITCH DETECTED ($killSwitch)" -ForegroundColor Red
    $disarm = Read-Host "Disarm kill switch to proceed? (y/n)"
    if ($disarm -eq 'y') {
        Remove-Item $killSwitch -Force
        Write-Host "Kill switch disarmed.`n" -ForegroundColor Green
    } else {
        Write-Host "Aborting. Remove $killSwitch manually to run." -ForegroundColor Red
        exit 1
    }
}

# Collect credentials
Write-Host "--- Stripe Credentials ---" -ForegroundColor White
$stripeEmail = Read-Host "Stripe email"
$stripePass = Read-Host "Stripe password" -AsSecureString

Write-Host "`n--- Vercel Credentials ---" -ForegroundColor White
$vercelEmail = Read-Host "Vercel email"
$vercelPass = Read-Host "Vercel password" -AsSecureString

Write-Host "`n--- Configuration ---" -ForegroundColor White
$project = Read-Host "Vercel project name [heidi-chat-portal]"
if (-not $project) { $project = "heidi-chat-portal" }

$webhookUrl = Read-Host "Webhook URL [https://$project.vercel.app/api/webhooks/stripe]"
if (-not $webhookUrl) { $webhookUrl = "https://$project.vercel.app/api/webhooks/stripe" }

Write-Host "`n--- Safety Settings ---" -ForegroundColor White
Write-Host "Execution mode: hid_required (full automation with confirmation gates)" -ForegroundColor Gray
Write-Host "Vision confidence threshold: 0.92" -ForegroundColor Gray
Write-Host "Rollback strategy: revert_webhook" -ForegroundColor Gray

$confirm = Read-Host "`nProceed with HID automation? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Aborted by user." -ForegroundColor Red
    exit 0
}

# Convert secure strings to plain text for JSON (config file is temporary)
$stripePasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($stripePass)
)
$vercelPasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($vercelPass)
)

# Create task config
$taskConfig = @{
    stripe_email = $stripeEmail
    stripe_password = $stripePasswordPlain
    vercel_email = $vercelEmail
    vercel_password = $vercelPasswordPlain
    vercel_project = $project
    webhook_endpoint_url = $webhookUrl
    webhook_events = @("payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded")
    contract = @{
        mode = "hid_required"
        requires_human_confirmation = $true
        min_vision_confidence = 0.92
        rollback_strategy = "revert_webhook"
        snapshot_before = $true
        max_retries = 1
    }
}

# Save config to temp file (will be deleted after run)
$configPath = "C:\tmp\hid_task_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
$taskConfig | ConvertTo-Json -Depth 5 | Set-Content $configPath

Write-Host "`n✓ Task config created: $configPath" -ForegroundColor Green
Write-Host "✓ Starting safety orchestrator...`n" -ForegroundColor Green

# Run the orchestrator
try {
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    python "$scriptPath\safety_orchestrator.py" --config $configPath
    
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Host "`n⚠ Orchestrator exited with code $exitCode" -ForegroundColor Yellow
    }
} finally {
    # Secure cleanup - overwrite then delete
    if (Test-Path $configPath) {
        $null = [System.IO.File]::WriteAllText($configPath, "$(Get-Random)$(Get-Random)$(Get-Random)")
        Remove-Item $configPath -Force
        Write-Host "`n✓ Credentials wiped from disk" -ForegroundColor Green
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  HID SETUP COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
