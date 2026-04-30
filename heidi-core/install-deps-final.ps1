Write-Host "Installing HEIDI deps (no native build required)..." -ForegroundColor Cyan
Set-Location $PSScriptRoot
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. All deps installed cleanly." -ForegroundColor Green
} else {
    Write-Host "npm install had errors. Check output above." -ForegroundColor Red
}
