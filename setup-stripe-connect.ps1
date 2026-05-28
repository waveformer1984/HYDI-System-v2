# setup-stripe-connect.ps1
# Fetches all 6 Connect account IDs, updates .env, generates onboarding links

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Read STRIPE_SECRET_KEY from .env ---
$envLines = Get-Content .env
$key = ($envLines | Where-Object { $_ -match '^STRIPE_SECRET_KEY=' }) -replace '^STRIPE_SECRET_KEY=', '' -replace '"', ''
if (-not $key -or -not $key.StartsWith('sk_')) {
    Write-Error "STRIPE_SECRET_KEY not found in .env"; exit 1
}
$headers = @{ Authorization = "Bearer $key" }

# --- Fetch connected accounts ---
Write-Host "`nFetching connected accounts from Stripe..." -ForegroundColor Cyan
$resp = Invoke-RestMethod "https://api.stripe.com/v1/accounts?limit=20" -Headers $headers
$accounts = $resp.data

if ($accounts.Count -eq 0) {
    Write-Host "No connected accounts found." -ForegroundColor Yellow; exit 0
}

# --- Display name → env var key mapping ---
$nameMap = @{
    'galactic'    = 'STRIPE_ACCOUNT_GALACTIC_BYTES'
    'detailer'    = 'STRIPE_ACCOUNT_DETAILER_BOT'
    'lipi'        = 'STRIPE_ACCOUNT_LIPI_V2'
    'protogrance' = 'STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS'
    'aromatic'    = 'STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS'
    'rezonate'    = 'STRIPE_ACCOUNT_REZONATE'
    'waveformer'  = 'STRIPE_ACCOUNT_WAVEFORMER_STUDIO'
    'studio'      = 'STRIPE_ACCOUNT_WAVEFORMER_STUDIO'
}

Write-Host "`nConnected accounts:" -ForegroundColor Cyan
$accountMap = @{}

foreach ($acct in $accounts) {
    $name = $acct.settings.dashboard.display_name
    if (-not $name) { $name = $acct.business_profile.name }
    if (-not $name) { $name = $acct.email }
    if (-not $name) { $name = "unknown" }

    $charges = $acct.charges_enabled
    $payouts  = $acct.payouts_enabled
    $status   = if ($charges -and $payouts) { "Active" } else { "Restricted" }

    # Find env var key by matching display name
    $envKey = $null
    foreach ($keyword in $nameMap.Keys) {
        if ($name.ToLower().Contains($keyword)) {
            $envKey = $nameMap[$keyword]
            break
        }
    }

    Write-Host ("  {0}  |  {1,-30}  |  {2,-10}  ->  {3}" -f $acct.id, $name, $status, ($envKey ?? "NO MATCH"))
    if ($envKey) { $accountMap[$envKey] = $acct.id }
}

# --- Patch .env ---
Write-Host "`nUpdating .env..." -ForegroundColor Cyan
$envContent = Get-Content .env -Raw
foreach ($envKey in $accountMap.Keys) {
    $acctId  = $accountMap[$envKey]
    $envContent = $envContent -replace "$envKey=.*", "$envKey=$acctId"
}
Set-Content .env $envContent -NoNewline
Write-Host "  .env updated with $($accountMap.Count) account ID(s)"

# --- Generate onboarding links for Restricted accounts ---
$returnUrl  = "https://heidi-chat-portal.vercel.app/"
$refreshUrl = "https://heidi-chat-portal.vercel.app/"

Write-Host "`nGenerating onboarding links for Restricted accounts..." -ForegroundColor Cyan
$anyRestricted = $false
foreach ($acct in $accounts) {
    $charges = $acct.charges_enabled
    $payouts  = $acct.payouts_enabled
    if (-not ($charges -and $payouts)) {
        $anyRestricted = $true
        $body = "account=$($acct.id)&refresh_url=$refreshUrl&return_url=$returnUrl&type=account_onboarding"
        try {
            $link = Invoke-RestMethod "https://api.stripe.com/v1/account_links" `
                -Method Post -Headers $headers `
                -Body $body -ContentType "application/x-www-form-urlencoded"
            $name = $acct.settings.dashboard.display_name ?? $acct.id
            Write-Host "`n  $name ($($acct.id)):" -ForegroundColor Yellow
            Write-Host "  $($link.url)" -ForegroundColor Green
        } catch {
            Write-Host "  Failed to generate link for $($acct.id): $_" -ForegroundColor Red
        }
    }
}
if (-not $anyRestricted) {
    Write-Host "  All accounts are Active — no onboarding needed." -ForegroundColor Green
}

# --- Restart servers ---
Write-Host "`nRestarting servers..." -ForegroundColor Cyan
& .\restart.ps1
