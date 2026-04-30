# Test Vercel token from production
$prodEnv = Get-Content ".env.production"
$tokenLine = $prodEnv | Where-Object { $_ -match "VERCEL_TOKEN=" }
if ($tokenLine) {
  $token = $tokenLine -replace "VERCEL_TOKEN=", ""
  $env:VERCEL_TOKEN = $token.Trim()
  Write-Host "VERCEL_TOKEN set from production file"
  node vercel-api-check.js
} else {
  Write-Host "VERCEL_TOKEN not found in production file"
}
