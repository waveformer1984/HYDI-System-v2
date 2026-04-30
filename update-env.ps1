# PowerShell script to update Supabase Service Role Key
# Usage: .\update-env.ps1 "your-service-role-key-here"

param(
    [Parameter(Mandatory=$true)]
    [string]$ServiceRoleKey
)

# Read the .env file
$envPath = ".env"
$envContent = Get-Content $envPath

# Replace the placeholder
$envContent = $envContent -replace 'SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY_HERE"', "SUPABASE_SERVICE_ROLE_KEY=`"$ServiceRoleKey`""

# Write back to file
Set-Content -Path $envPath -Value $envContent

Write-Host "✅ Updated .env file with your Service Role Key" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run: node start-workers.js" -ForegroundColor Yellow
