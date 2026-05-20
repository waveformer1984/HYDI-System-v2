# backup-critical.ps1
# Backs up the highest-value directories in HYDI_System to HYDI_System_BACKUP
# Run manually or schedule with Task Scheduler weekly.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\backup-critical.ps1

$src  = "C:\Users\Owner\HYDI_System"
$dest = "C:\Users\Owner\HYDI_System_BACKUP"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = "$dest\backup_$stamp"

# Directories to back up (cascade JSON files live in heidi-core/data at runtime)
$targets = @(
    "heidi-core\data",       # heidi_memory.db + any cascade-*.json generated at runtime
    "heidi-core",            # cascade engine JS — not large, critical logic
    "governance",            # shadow governance + hooks (deployed today)
    "hydi_scripts",          # main.py + trading_loop.py (updated today)
    "knowledge_base",        # expand this over time
    "audit",
    "agents",
    "workers",
    "src",
    "migrations",
    "supabase"
)

Write-Host "`n[HYDI BACKUP] Starting backup $stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$totalMB = 0
foreach ($t in $targets) {
    $srcPath = "$src\$t"
    if (-not (Test-Path $srcPath)) {
        Write-Host "  SKIP (not found): $t"
        continue
    }
    $destPath = "$backupRoot\$t"
    New-Item -ItemType Directory -Path (Split-Path $destPath) -Force | Out-Null
    Copy-Item -Path $srcPath -Destination $destPath -Recurse -Force
    $size = (Get-ChildItem $destPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $mb = [math]::Round($size / 1MB, 2)
    $totalMB += $mb
    Write-Host "  OK  $t  ($mb MB)"
}

# Also back up .env files (credentials template only - not secrets)
Copy-Item "$src\.env.example"   "$backupRoot\.env.example"   -ErrorAction SilentlyContinue
Copy-Item "$src\.env.template"  "$backupRoot\.env.template"  -ErrorAction SilentlyContinue

# Write backup manifest
$manifest = @{
    timestamp   = (Get-Date -Format "o")
    backup_path = $backupRoot
    total_mb    = $totalMB
    targets     = $targets
} | ConvertTo-Json
$manifest | Out-File "$backupRoot\BACKUP_MANIFEST.json" -Encoding utf8

Write-Host "`n[HYDI BACKUP] Done. Total: $totalMB MB -> $backupRoot"
Write-Host "[HYDI BACKUP] Manifest written to BACKUP_MANIFEST.json`n"

# Prune backups older than 30 days
$old = Get-ChildItem $dest -Filter "backup_*" -Directory | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) }
if ($old) {
    $old | Remove-Item -Recurse -Force
    Write-Host "[HYDI BACKUP] Pruned $($old.Count) old backup(s) older than 30 days."
}
