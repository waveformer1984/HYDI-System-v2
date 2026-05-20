# health-check.ps1
# Quick system health report for HYDI_System.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\health-check.ps1

$root = "C:\Users\Owner\HYDI_System"
$issues = @()
$ok = @()

Write-Host ""
Write-Host "=============================="
Write-Host " HYDI System Health Check"
Write-Host " $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "=============================="
Write-Host ""

# ---- 1. Running processes ----
Write-Host "[1] Services / Processes"
$nodeProcs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "node|python" }
if ($nodeProcs) {
    $nodeProcs | ForEach-Object {
        $mb = [math]::Round($_.WorkingSet64/1MB,1)
        Write-Host "    RUNNING: $($_.Name) PID=$($_.Id) ($($mb) MB)"
    }
    $ok += "Services running"
} else {
    Write-Host "    WARNING: No node/python processes found - workers may be stopped"
    $issues += "No node/python processes running"
}

# HEIDI endpoint ping
try {
    $heidi = Invoke-RestMethod -Uri "http://127.0.0.1:3458/health" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "    HEIDI: OK (model=$($heidi.model) sessions=$($heidi.sessions) tasks=$($heidi.tasks))"
    $ok += "HEIDI endpoint responding"
} catch {
    Write-Host "    HEIDI: NOT RESPONDING on port 3458"
    $issues += "HEIDI endpoint not responding"
}

# Ollama LLM backend
try {
    $ollama = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
    $models = ($ollama.models | ForEach-Object { $_.name }) -join ", "
    Write-Host "    OLLAMA: OK (models: $models)"
    $ok += "Ollama LLM backend online"
} catch {
    Write-Host "    OLLAMA: offline - /think calls will fail (start with: ollama serve)"
    $issues += "Ollama offline - LLM backend unavailable"
}

# ---- 2. C: drive space ----
Write-Host ""
Write-Host "[2] Disk Space"
$drive = Get-PSDrive C
$freeGB = [math]::Round($drive.Free / 1GB, 1)
$usedGB = [math]::Round($drive.Used / 1GB, 1)
Write-Host "    C:\ Used: $($usedGB) GB  Free: $($freeGB) GB"
if ($freeGB -lt 10) {
    $issues += "C: drive low on space ($($freeGB) GB free)"
    Write-Host "    WARNING: Less than 10 GB free!"
} else {
    $ok += "Disk space OK ($($freeGB) GB free)"
}

# ---- 3. Orphaned temp files ----
Write-Host ""
Write-Host "[3] Orphaned Temp Files"
$orphans = Get-ChildItem "$env:TEMP" -Filter "*.py" -ErrorAction SilentlyContinue
if ($orphans) {
    $orphans | ForEach-Object {
        $kb = [math]::Round($_.Length/1KB,1)
        Write-Host "    ORPHAN: $($_.FullName) ($($kb) KB)"
    }
    $issues += "$($orphans.Count) orphan .py file(s) in TEMP"
} else {
    Write-Host "    OK - no orphaned .py files in TEMP"
    $ok += "No temp orphans"
}

# ---- 4. Cascade data files ----
Write-Host ""
Write-Host "[4] Cascade Data"
$cascadeData = Get-ChildItem "$root\heidi-core\data" -Filter "*.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 1MB }
if ($cascadeData) {
    $cascadeData | ForEach-Object {
        $mb = [math]::Round($_.Length/1MB,2)
        Write-Host "    OK: $($_.Name) ($($mb) MB)"
    }
    $ok += "Cascade JSON files present"
} else {
    Write-Host "    INFO: No large cascade JSON files - generated at runtime"
}

# ---- 5. Supabase config ----
Write-Host ""
Write-Host "[5] Supabase Config"
$envFile = "$root\.env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    $hasUrl = $envContent -match 'SUPABASE_URL\s*=\s*"?https://'
    $hasKey = $envContent -match 'SUPABASE_SERVICE_ROLE_KEY\s*=\s*"?eyJ'
    if ($hasUrl -and $hasKey) {
        Write-Host "    OK - SUPABASE_URL and SERVICE_ROLE_KEY present"
        $ok += "Supabase env configured"
    } else {
        Write-Host "    WARNING: Supabase credentials may be incomplete"
        $issues += "Supabase credentials incomplete in .env"
    }
} else {
    Write-Host "    ERROR: .env file not found"
    $issues += ".env file missing"
}

# ---- 6. Knowledge base ----
Write-Host ""
Write-Host "[6] Knowledge Base"
$kbFiles = Get-ChildItem "$root\knowledge_base" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { -not $_.PSIsContainer }
if ($kbFiles) {
    $totalKB = [math]::Round(($kbFiles | Measure-Object Length -Sum).Sum / 1KB, 1)
    Write-Host "    $($kbFiles.Count) file(s) - $($totalKB) KB total"
    $ok += "Knowledge base has content"
} else {
    Write-Host "    INFO: knowledge_base is empty - needs seeding"
    $issues += "knowledge_base is empty"
}

# ---- 7. Recent backup ----
Write-Host ""
Write-Host "[7] Backup Status"
$backupDest = "C:\Users\Owner\HYDI_System_BACKUP"
$backups = Get-ChildItem $backupDest -Filter "backup_*" -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
if ($backups) {
    $latest = $backups[0]
    $ageHours = [math]::Round(((Get-Date) - $latest.LastWriteTime).TotalHours, 1)
    Write-Host "    Latest: $($latest.Name) ($($ageHours) hours ago)"
    if ($ageHours -gt 168) {
        $issues += "Backup is older than 7 days"
    } else {
        $ok += "Recent backup exists"
    }
} else {
    Write-Host "    WARNING: No backups found in HYDI_System_BACKUP"
    $issues += "No backups found - run scripts\backup-critical.ps1"
}

# ---- Summary ----
Write-Host ""
Write-Host "=============================="
Write-Host " Summary"
Write-Host "=============================="
Write-Host "  OK:     $($ok.Count) checks passed"
Write-Host "  ISSUES: $($issues.Count) item(s) need attention"
foreach ($i in $issues) { Write-Host "  - $i" }
Write-Host ""
