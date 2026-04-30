# Clean PowerShell deployment script
# No chaos, no missing brackets, just working code

function Deploy-Function {
    param (
        [string]$name
    )
    
    try {
        Write-Host "Deploying $name..." -ForegroundColor Cyan
        $result = supabase functions deploy $name --project-ref akbnfovjdcobifeupvbn
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Success: $name deployed" -ForegroundColor Green
        } else {
            Write-Host "Failed to deploy $name" -ForegroundColor Red
            Write-Host $result -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "Error deploying $name" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Yellow
    }
}

# Deploy functions in order
Write-Host "`nDEPLOYING SUPABASE FUNCTIONS" -ForegroundColor Magenta
Write-Host "==============================" -ForegroundColor Magenta

Deploy-Function "monthly-payout-calculation"
Deploy-Function "stripe-transfer-payout"

Write-Host "`nDeployment complete!" -ForegroundColor Green
