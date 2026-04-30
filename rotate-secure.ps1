# SECURE ROTATION - NO EXPOSURE EVER
Write-Host "SECURE TOKEN ROTATION" -ForegroundColor Yellow
Write-Host "====================" -ForegroundColor Yellow

# Generate new token without display
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$newToken = -join ($bytes | ForEach-Object { "{0:x2}" -f $_ })

Write-Host "Token generated. Never displayed." -ForegroundColor Green

# Remove old token from Vercel
Write-Host "Removing old token from Vercel..." -ForegroundColor Cyan
vercel env rm KEEPER_BREAK_GLASS_TOKEN production

# Add new token to Vercel (direct input)
Write-Host "Adding new token to Vercel..." -ForegroundColor Cyan
$newToken | vercel env add KEEPER_BREAK_GLASS_TOKEN production

# Add new token to Supabase (direct input)
Write-Host "Adding new token to Supabase..." -ForegroundColor Cyan
$env:SECRET_INPUT = $newToken
supabase secrets set KEEPER_BREAK_GLASS_TOKEN=$env:SECRET_INPUT

# Update local .env without display
Write-Host "Updating local .env..." -ForegroundColor Cyan
(Get-Content .env) -replace "KEEPER_BREAK_GLASS_TOKEN=.*", "KEEPER_BREAK_GLASS_TOKEN=[REDACTED]" | Set-Content .env

# Clean up
$env:SECRET_INPUT = $null
$rng.Dispose()

Write-Host "Rotation complete. Token never exposed." -ForegroundColor Green
Write-Host "Deploying..." -ForegroundColor Cyan
vercel --prod
