# Deploy heidi-reflect function with --no-verify-jwt
# This fixes the 401 authentication issue

$ErrorActionPreference = "Stop"

try {
    Write-Host "Deploying heidi-reflect function..." -ForegroundColor Cyan
    Write-Host "Project: akbnfovjdcobifeupvbn" -ForegroundColor Gray
    Write-Host "Flag: --no-verify-jwt" -ForegroundColor Gray
    Write-Host ""
    
    # Deploy with JWT verification disabled (header-based auth instead)
    $result = supabase functions deploy heidi-reflect --project-ref akbnfovjdcobifeupvbn --no-verify-jwt 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ SUCCESS: heidi-reflect deployed with header-based auth" -ForegroundColor Green
        Write-Host ""
        Write-Host "Verification query to run:" -ForegroundColor Yellow
        Write-Host "select created, status_code, error_msg from net._http_response where created > now() - interval '15 minutes' order by created desc;" -ForegroundColor Gray
    } else {
        Write-Host "✗ DEPLOYMENT FAILED" -ForegroundColor Red
        Write-Host $result -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "✗ ERROR: $_" -ForegroundColor Red
    exit 1
}
