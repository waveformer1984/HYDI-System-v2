# ==============================================================================
# HYDI WINDOWS SERVICE INSTALLER  — run once from an ELEVATED PowerShell
# ==============================================================================
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$HydiRoot = "F:\HYDI_System"
$NodeExe  = "C:\Program Files\nodejs\node.exe"

# Reload PATH so nssm is available in this elevated session
$env:PATH = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  HYDI Core Substrate — Windows Service Installation" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# ── Verify prerequisites ──────────────────────────────────────────────────────
Write-Host "`n[PRE-FLIGHT] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error "nssm not found. Run: winget install NSSM.NSSM --source winget"
}
if (-not (Test-Path $NodeExe)) {
    Write-Error "Node.exe not found at $NodeExe. Adjust `$NodeExe variable."
}
if (-not (Test-Path "$HydiRoot\ursula-dashboard-enhanced.js")) {
    Write-Error "ursula-dashboard-enhanced.js missing from $HydiRoot. Ensure hydi-ops-pr branch is checked out."
}
if (-not (Test-Path "$HydiRoot\hydi-orchestrator.js")) {
    Write-Error "hydi-orchestrator.js missing from $HydiRoot."
}
Write-Host "[OK] Prerequisites verified." -ForegroundColor Green

# ── STEP 1: Service account ───────────────────────────────────────────────────
Write-Host "`n[STEP 1] Provisioning SVC_HYDICore service account..." -ForegroundColor Yellow

if (-not (Get-LocalUser -Name "SVC_HYDICore" -ErrorAction SilentlyContinue)) {
    # NOTE: Replace the placeholder below with a strong password before running.
    # Do NOT commit this file with the real password filled in.
    $SvcPassword = Read-Host "Enter password for SVC_HYDICore" -AsSecureString
    New-LocalUser -Name "SVC_HYDICore" -Password $SvcPassword `
        -Description "HYDI Core Substrate Execution Account" `
        -UserMayNotChangePassword -PasswordNeverExpires
    Write-Host "[CREATED] SVC_HYDICore" -ForegroundColor Green
} else {
    Write-Host "[EXISTS]  SVC_HYDICore already present — skipping creation." -ForegroundColor Yellow
    # Still need the password for nssm set ObjectName below
    $SvcPassword = Read-Host "Enter current password for SVC_HYDICore (needed for service logon)" -AsSecureString
}

# Convert SecureString -> plain for nssm (stays in memory only, not written to disk)
$SvcPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SvcPassword)
)

# ── STEP 2: File-system ACL ───────────────────────────────────────────────────
Write-Host "`n[STEP 2] Configuring file-system ACL on $HydiRoot..." -ForegroundColor Yellow

$Acl = Get-Acl $HydiRoot
$Acl.SetAccessRuleProtection($true, $true)   # detach inheritance, copy existing rules
$Rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    ".\SVC_HYDICore", "Modify",
    "ContainerInherit,ObjectInherit", "None", "Allow"
)
$Acl.SetAccessRule($Rule)
Set-Acl $HydiRoot $Acl
Write-Host "[PASSED] ACL: inheritance stripped, SVC_HYDICore granted Modify on $HydiRoot" -ForegroundColor Green

# ── STEP 3: Stop PM2 on affected ports (3003, 3004) ──────────────────────────
Write-Host "`n[STEP 3] Stopping PM2 services that overlap with Windows services..." -ForegroundColor Yellow

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
    pm2 stop hydi-ursula    2>$null
    pm2 stop hydi-processor 2>$null
    Write-Host "[OK] PM2 services stopped." -ForegroundColor Green
} else {
    Write-Host "[SKIP] pm2 not found — skipping." -ForegroundColor Yellow
}

# ── STEP 4: NSSM — HYDI_Orchestrator ─────────────────────────────────────────
Write-Host "`n[STEP 4a] Installing HYDI_Orchestrator Windows service..." -ForegroundColor Yellow

# Remove existing service if present (idempotent reinstall)
$existing = Get-Service -Name "HYDI_Orchestrator" -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -eq "Running") { Stop-Service HYDI_Orchestrator -Force }
    nssm remove HYDI_Orchestrator confirm
}

nssm install   HYDI_Orchestrator $NodeExe "F:\HYDI_System\hydi-orchestrator.js"
nssm set       HYDI_Orchestrator AppDirectory     $HydiRoot
nssm set       HYDI_Orchestrator ObjectName       ".\SVC_HYDICore" $SvcPlain
nssm set       HYDI_Orchestrator Start            SERVICE_DELAYED_AUTO_START
nssm set       HYDI_Orchestrator AppThrottle      1500
nssm set       HYDI_Orchestrator AppExit          Default Restart
nssm set       HYDI_Orchestrator AppRestartDelay  5000
nssm set       HYDI_Orchestrator AppStdout        "$HydiRoot\logs\orchestrator-out.log"
nssm set       HYDI_Orchestrator AppStderr        "$HydiRoot\logs\orchestrator-err.log"
nssm set       HYDI_Orchestrator AppStdoutCreationDisposition 4   # append
nssm set       HYDI_Orchestrator AppStderrCreationDisposition 4

Write-Host "[PASSED] HYDI_Orchestrator registered." -ForegroundColor Green

# ── STEP 5: NSSM — HYDI_Dashboard ────────────────────────────────────────────
Write-Host "`n[STEP 4b] Installing HYDI_Dashboard Windows service..." -ForegroundColor Yellow

$existing2 = Get-Service -Name "HYDI_Dashboard" -ErrorAction SilentlyContinue
if ($existing2) {
    if ($existing2.Status -eq "Running") { Stop-Service HYDI_Dashboard -Force }
    nssm remove HYDI_Dashboard confirm
}

nssm install   HYDI_Dashboard $NodeExe "F:\HYDI_System\ursula-dashboard-enhanced.js"
nssm set       HYDI_Dashboard AppDirectory     $HydiRoot
nssm set       HYDI_Dashboard ObjectName       ".\SVC_HYDICore" $SvcPlain
nssm set       HYDI_Dashboard Start            SERVICE_DELAYED_AUTO_START
nssm set       HYDI_Dashboard AppThrottle      1500
nssm set       HYDI_Dashboard AppExit          Default Restart
nssm set       HYDI_Dashboard AppRestartDelay  4000
nssm set       HYDI_Dashboard AppStdout        "$HydiRoot\logs\dashboard-out.log"
nssm set       HYDI_Dashboard AppStderr        "$HydiRoot\logs\dashboard-err.log"
nssm set       HYDI_Dashboard AppStdoutCreationDisposition 4
nssm set       HYDI_Dashboard AppStderrCreationDisposition 4

Write-Host "[PASSED] HYDI_Dashboard registered." -ForegroundColor Green

# ── Clear the password from memory ───────────────────────────────────────────
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SvcPassword)
)
$SvcPlain = $null

# ── STEP 6: Create log directory ─────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "$HydiRoot\logs" | Out-Null

# ── STEP 7: Grant SVC_HYDICore logon-as-service right ───────────────────────
Write-Host "`n[STEP 6] Granting SVC_HYDICore 'Log on as a service' right..." -ForegroundColor Yellow

$sidStr = (Get-LocalUser -Name "SVC_HYDICore").SID.Value
$tempInf = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.inf'
$tempSdb = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.sdb'
$currentCfg = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.cfg'

secedit /export /cfg $currentCfg /quiet

$cfg = Get-Content $currentCfg
$logonSvcLine = $cfg | Where-Object { $_ -match "^SeServiceLogonRight" }
if ($logonSvcLine) {
    $newLine = $logonSvcLine + ",*$sidStr"
    $cfg = $cfg -replace [regex]::Escape($logonSvcLine), $newLine
} else {
    $cfg += "SeServiceLogonRight = *$sidStr"
}
$cfg | Out-File $tempInf -Encoding unicode

secedit /configure /db $tempSdb /cfg $tempInf /quiet
Remove-Item $tempInf, $tempSdb, $currentCfg -Force -ErrorAction SilentlyContinue

Write-Host "[PASSED] Service logon right granted." -ForegroundColor Green

# ── STEP 8: Start services ────────────────────────────────────────────────────
Write-Host "`n[STEP 7] Starting HYDI Windows services..." -ForegroundColor Yellow

Start-Service HYDI_Orchestrator
Start-Sleep -Seconds 3
Start-Service HYDI_Dashboard
Start-Sleep -Seconds 3

# ── Final validation ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Service Status" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Get-Service -Name "HYDI_*" | Select-Object Name, Status, StartType | Format-Table -AutoSize

Write-Host "================================================================" -ForegroundColor Green
Write-Host "  HYDI Runtime Online." -ForegroundColor Green
Write-Host "  Dashboard:     http://localhost:3004" -ForegroundColor Green
Write-Host "  Logs:          $HydiRoot\logs\" -ForegroundColor Green
Write-Host "  Manage:        nssm restart HYDI_Dashboard" -ForegroundColor Green
Write-Host "                 Get-Service HYDI_* | Select Name,Status" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
