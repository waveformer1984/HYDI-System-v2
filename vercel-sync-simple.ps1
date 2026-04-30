# Simple Vercel sync script
Write-Host "VERCEL SYNC CHECK" -ForegroundColor Magenta
Write-Host "================" -ForegroundColor Magenta

# Pull Vercel environment
Write-Host "Pulling Vercel environment..."
vercel env pull .env.production

# Check if file exists
if (Test-Path ".env.production") {
    Write-Host "Vercel environment pulled successfully" -ForegroundColor Green
    
    # Compare file sizes
    $localSize = (Get-Item ".env").Length
    $vercelSize = (Get-Item ".env.production").Length
    
    Write-Host "Local .env: $localSize bytes"
    Write-Host "Vercel .env.production: $vercelSize bytes"
    
    if ($vercelSize -eq 0) {
        Write-Host "WARNING: Vercel environment file is empty" -ForegroundColor Yellow
    }
} else {
    Write-Host "ERROR: Failed to pull Vercel environment" -ForegroundColor Red
}

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Add missing keys: vercel env add STRIPE_SECRET_KEY" -ForegroundColor Gray
Write-Host "2. Add break glass: vercel env add KEEPER_BREAK_GLASS_TOKEN" -ForegroundColor Gray
Write-Host "3. Redeploy: vercel --prod" -ForegroundColor Gray
