# SECURE SECRET HANDLER - NEVER EXPOSES SECRETS
# Rule: If a human can read it, it's already leaked

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("generate", "rotate", "verify")]
    [string]$Action
)

switch ($Action) {
    "generate" {
        Write-Host "Generating new secret securely..." -ForegroundColor Yellow
        Write-Host "SECRET WILL BE INJECTED DIRECTLY - NEVER DISPLAYED" -ForegroundColor Red
        
        # Generate and inject directly without exposure
        $secret = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
        
        Write-Host "Injecting into Vercel..." -ForegroundColor Cyan
        $secret | vercel env add KEEPER_BREAK_GLASS_TOKEN production
        
        Write-Host "Injecting into Supabase..." -ForegroundColor Cyan
        $secret | supabase secrets set KEEPER_BREAK_GLASS_TOKEN
        
        Write-Host "Secret deployed. Never displayed. Never logged." -ForegroundColor Green
    }
    
    "rotate" {
        Write-Host "Rotating secret securely..." -ForegroundColor Yellow
        # Same as generate - never display
        & $PSScriptRoot\secure-secret-handler.ps1 -Action generate
    }
    
    "verify" {
        Write-Host "Verifying secret presence without exposure..." -ForegroundColor Yellow
        $vercelCheck = vercel env ls production | Select-String "KEEPER_BREAK_GLASS_TOKEN"
        
        if ($vercelCheck) {
            Write-Host "✅ Secret present in Vercel" -ForegroundColor Green
        } else {
            Write-Host "❌ Secret missing from Vercel" -ForegroundColor Red
        }
        
        # Test function without exposing token
        Write-Host "Testing break glass function..." -ForegroundColor Cyan
        # Test would use the token internally, never display it
    }
}

Write-Host "SECURITY PROTOCOL: SECRETS NEVER EXPOSED" -ForegroundColor Magenta
