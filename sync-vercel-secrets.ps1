# Sync Vercel secrets with local environment
# Run this after updating your .env file

Write-Host "🔄 SYNCING VERCEL SECRETS" -ForegroundColor Magenta
Write-Host "======================" -ForegroundColor Magenta

# Step 1: Pull current Vercel environment
Write-Host "`n1️⃣ Pulling current Vercel environment..." -ForegroundColor Cyan
try {
    vercel env pull .env.production
    Write-Host "✅ Vercel environment pulled to .env.production" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to pull Vercel environment" -ForegroundColor Red
    Write-Host "Make sure you're logged in: vercel login" -ForegroundColor Yellow
}

# Step 2: Check for missing keys that need to be added
Write-Host "`n2️⃣ Checking for missing keys in Vercel..." -ForegroundColor Cyan

# Check if STRIPE_SECRET_KEY exists in Vercel
try {
    $stripeKey = vercel env get STRIPE_SECRET_KEY
    if ($stripeKey -match "not found") {
        Write-Host "STRIPE_SECRET_KEY missing in Vercel" -ForegroundColor Yellow
        Write-Host "Run: vercel env add STRIPE_SECRET_KEY" -ForegroundColor Yellow
    } else {
        Write-Host "STRIPE_SECRET_KEY exists in Vercel" -ForegroundColor Green
    }
} catch {
    Write-Host "STRIPE_SECRET_KEY check failed" -ForegroundColor Yellow
}

# Check if KEEPER_BREAK_GLASS_TOKEN exists in Vercel  
try {
    $breakGlassToken = vercel env get KEEPER_BREAK_GLASS_TOKEN
    if ($breakGlassToken -match "not found") {
        Write-Host "KEEPER_BREAK_GLASS_TOKEN missing in Vercel" -ForegroundColor Yellow
        Write-Host "Run: vercel env add KEEPER_BREAK_GLASS_TOKEN" -ForegroundColor Yellow
    } else {
        Write-Host "KEEPER_BREAK_GLASS_TOKEN exists in Vercel" -ForegroundColor Green
    }
} catch {
    Write-Host "KEEPER_BREAK_GLASS_TOKEN check failed" -ForegroundColor Yellow
}

# Step 3: Compare local vs Vercel
Write-Host "`n3️⃣ Comparing local vs Vercel..." -ForegroundColor Cyan

if (Test-Path ".env.production") {
    $prodEnv = Get-Content ".env.production"
    $localEnv = Get-Content ".env"
    
    Write-Host "📊 Environment comparison:" -ForegroundColor White
    Write-Host "Local .env has $($localEnv.Count) lines" -ForegroundColor Gray
    Write-Host "Vercel .env.production has $($prodEnv.Count) lines" -ForegroundColor Gray
    
    # Check for key differences
    $localKeys = $localEnv | Where-Object { $_ -match "^[A-Z_]+" } | ForEach-Object { $_.Split('=')[0] }
    $vercelKeys = $prodEnv | Where-Object { $_ -match "^[A-Z_]+" } | ForEach-Object { $_.Split('=')[0] }
    
    $missingInVercel = $localKeys | Where-Object { $_ -notin $vercelKeys }
    $missingInLocal = $vercelKeys | Where-Object { $_ -notin $localKeys }
    
    if ($missingInVercel) {
        Write-Host "`n⚠️  Keys in local but not in Vercel:" -ForegroundColor Yellow
        $missingInVercel | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
    }
    
    if ($missingInLocal) {
        Write-Host "`n⚠️  Keys in Vercel but not in local:" -ForegroundColor Yellow
        $missingInLocal | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
    }
    
    if (-not $missingInVercel -and -not $missingInLocal) {
        Write-Host "✅ Keys are synchronized" -ForegroundColor Green
    }
} else {
    Write-Host "❌ .env.production file not found" -ForegroundColor Red
}

# Step 4: Next steps
Write-Host "`n📋 NEXT STEPS:" -ForegroundColor Magenta
Write-Host "===============" -ForegroundColor Magenta
Write-Host "1. Add missing keys to Vercel:" -ForegroundColor White
Write-Host "   vercel env add STRIPE_SECRET_KEY" -ForegroundColor Gray
Write-Host "   vercel env add KEEPER_BREAK_GLASS_TOKEN" -ForegroundColor Gray
Write-Host "" -ForegroundColor White
Write-Host "2. Update existing keys if rotated:" -ForegroundColor White
Write-Host "   vercel env rm SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Gray
Write-Host "   vercel env add SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Gray
Write-Host "" -ForegroundColor White
Write-Host "3. Redeploy to apply changes:" -ForegroundColor White
Write-Host "   vercel --prod" -ForegroundColor Gray
Write-Host "" -ForegroundColor White
Write-Host "4. Verify deployment:" -ForegroundColor White
Write-Host "   vercel env ls" -ForegroundColor Gray
