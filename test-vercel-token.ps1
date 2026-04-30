# Test Vercel token setup
$tempEnv = Get-Content ".env.temp"
$tokenLine = $tempEnv | Where-Object { $_ -match "VERCEL_TOKEN=" }
if ($tokenLine) {
  $token = $tokenLine -replace "VERCEL_TOKEN=", ""
  $env:VERCEL_TOKEN = $token.Trim()
  Write-Host "VERCEL_TOKEN set from temp file"
  node vercel-api-check.js
} else {
  Write-Host "VERCEL_TOKEN not found in temp file"
}
