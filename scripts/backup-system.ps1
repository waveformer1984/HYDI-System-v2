# HYDI Full System Backup Script
# Backs up the entire HYDI_System directory with timestamped versioning
# Run: .\scripts\backup-system.ps1

param(
    [string]$Source = "C:\Users\Owner\HYDI_System",
    [string]$BackupRoot = "C:\Users\Owner\HYDI_System_BACKUP",
    [int]$KeepVersions = 5
)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $BackupRoot "backup_$timestamp"

Write-Host "========================================"
Write-Host "HYDI System Backup"
Write-Host "Source:      $Source"
Write-Host "Destination: $backupDir"
Write-Host "========================================"

# Validate source exists
if (-not (Test-Path $Source)) {
    Write-Error "Source path does not exist: $Source"
    exit 1
}

# Create backup directory
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# Exclude patterns to reduce size and avoid recursion
$exclude = @(
    "node_modules",
    "__pycache__",
    ".git\objects\pack",
    "*.log",
    "*.tmp",
    "*.cache"
)

Write-Host "Copying files..."

# Use robocopy for robust file copying with exclusions
$robocopyArgs = @(
    $Source,
    $backupDir,
    "/E",                           # Include subdirectories (including empty)
    "/R:2",                         # Retry twice
    "/W:5",                         # Wait 5s between retries
    "/MT:8",                        # Multi-threaded
    "/XD", "node_modules", "__pycache__", ".git", "venv", "hydi_venv",
    "/XF", "*.log", "*.tmp", "*.cache"
)

$proc = Start-Process -FilePath "robocopy" -ArgumentList $robocopyArgs -Wait -PassThru -WindowStyle Hidden

if ($proc.ExitCode -le 7) {
    Write-Host "Backup completed successfully."
} else {
    Write-Warning "Robocopy completed with exit code $($proc.ExitCode) (codes 0-7 are generally OK, >7 may indicate errors)"
}

# Write manifest
$manifest = @{
    timestamp = $timestamp
    source = $Source
    destination = $backupDir
    exitCode = $proc.ExitCode
    hostname = $env:COMPUTERNAME
    user = $env:USERNAME
} | ConvertTo-Json -Depth 3

$manifest | Out-File -FilePath (Join-Path $backupDir "backup_manifest.json") -Encoding utf8

# Cleanup old versions (keep only $KeepVersions most recent)
$existingBackups = Get-ChildItem -Path $BackupRoot -Directory |
    Where-Object { $_.Name -match '^backup_\d{8}_\d{6}$' } |
    Sort-Object CreationTime -Descending

if ($existingBackups.Count -gt $KeepVersions) {
    $toRemove = $existingBackups | Select-Object -Skip $KeepVersions
    foreach ($dir in $toRemove) {
        Write-Host "Removing old backup: $($dir.Name)"
        Remove-Item -Path $dir.FullName -Recurse -Force
    }
}

Write-Host ""
Write-Host "Backup manifest: $backupDir\backup_manifest.json"
Write-Host "Done."
