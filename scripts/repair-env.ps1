<#
.SYNOPSIS
    Repairs the .env damage from the bad append and adds the
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY alias the browser Supabase client needs.

.DESCRIPTION
    - Backs up .env first (timestamped).
    - Removes the garbled "STRIPENEXT_PUBLIC_..." line left by the bad append.
    - Derives NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from the intact
      SUPABASE_PUBLISHABLE_KEY line (value never printed).
    - If STRIPE_ACCOUNT_LIPI_V2 was lost in the corruption, prompts you to paste
      the acct_... id from Stripe Dashboard -> Connect -> Accounts (optional).
    - Writes UTF-8 WITHOUT a BOM (a BOM would break dotenv parsing of the first var).
    - Verifies by NAME only — no secret values are ever displayed.

.PARAMETER EnvPath
    Path to the .env to repair. Defaults to .\.env. If your running Next.js was
    started from C:\Users\Owner\HYDI-System-v2, point this at that folder's .env.

.EXAMPLE
    cd C:\Users\Owner\HYDI_System
    powershell -ExecutionPolicy Bypass -File scripts\repair-env.ps1
#>
[CmdletBinding()]
param([string]$EnvPath = ".env")

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvPath)) { throw "Not found: $EnvPath  (run from the repo root)" }

# 1. Backup
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$EnvPath.bak-$stamp"
Copy-Item $EnvPath $backup
Write-Host "Backed up to $backup" -ForegroundColor Green

# 2. Read
$lines = Get-Content $EnvPath

# 3. Recover the publishable key value from the intact line (not printed)
$pubLine = $lines | Where-Object { $_ -match '^SUPABASE_PUBLISHABLE_KEY=' } | Select-Object -First 1
if (-not $pubLine) { throw "SUPABASE_PUBLISHABLE_KEY not found; cannot derive the NEXT_PUBLIC alias." }
$pubVal = $pubLine -replace '^SUPABASE_PUBLISHABLE_KEY=', ''

# 4. Drop the garbled line and any pre-existing NEXT_PUBLIC alias (so re-runs are clean)
$clean = $lines | Where-Object {
    $_ -notmatch '^STRIPENEXT' -and
    $_ -notmatch '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='
}

# 5. Did STRIPE_ACCOUNT_LIPI_V2 survive?
$hasLipi = @($clean | Where-Object { $_ -match '^STRIPE_ACCOUNT_LIPI_V2=' }).Count -gt 0
if (-not $hasLipi) {
    Write-Host "STRIPE_ACCOUNT_LIPI_V2 is missing (lost in the corruption)." -ForegroundColor Yellow
    $lipi = Read-Host "Paste the LIPI_V2 Connect account id (acct_...) from Stripe, or press Enter to skip"
    if ($lipi.Trim()) { $clean += "STRIPE_ACCOUNT_LIPI_V2=$($lipi.Trim())" }
}

# 6. Add the NEXT_PUBLIC alias
$clean += "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$pubVal"

# 7. Write UTF-8 (no BOM)
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines((Resolve-Path $EnvPath).Path, $clean, $enc)
Write-Host "Repaired $EnvPath" -ForegroundColor Green

# 8. Verify — NAMES ONLY, no values
Write-Host "`nVerification (names only):"
$now = Get-Content $EnvPath
foreach ($key in 'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','STRIPE_ACCOUNT_LIPI_V2') {
    $present = @($now | Where-Object { $_ -match ("^" + [regex]::Escape($key) + "=") }).Count -gt 0
    "{0,-42} {1}" -f $key, $(if ($present) { 'present' } else { 'MISSING' })
}
$garbled     = @($now | Where-Object { $_ -match '^STRIPENEXT' }).Count
$stripeCount = @($now | Where-Object { $_ -match '^STRIPE_ACCOUNT_' }).Count
$nodeEnv     = @($now | Where-Object { $_ -match '^NODE_ENV=' }).Count
Write-Host ("garbled STRIPENEXT line remaining (want 0): {0}" -f $garbled)
Write-Host ("STRIPE_ACCOUNT_* count: {0}" -f $stripeCount)
Write-Host ("NODE_ENV present (want 0): {0}" -f $nodeEnv)
Write-Host "`nDone. Restart the boot agent and reload the dashboard." -ForegroundColor Cyan
