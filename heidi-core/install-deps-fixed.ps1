# Install HEIDI dependencies (PowerShell friendly)
cd $PSScriptRoot
Write-Host "Installing HEIDI dependencies..." -ForegroundColor Cyan
npm install express axios sqlite3 --save
Write-Host "Done. If sqlite3 failed, HEIDI will use in-memory mode with warning." -ForegroundColor Green
