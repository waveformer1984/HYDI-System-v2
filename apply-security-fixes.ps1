# Apply security fixes directly via Supabase SQL
$ErrorActionPreference = "Stop"

function Write-Log($msg) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] $msg"
  Add-Content -Path "security-fixes-application.log" -Value "[$timestamp] $msg" -ErrorAction SilentlyContinue
}

try {
  Write-Log "Applying security fixes..."
  
  # Read the SQL file
  $sqlContent = Get-Content "security-fixes-delivery.sql" -Raw
  
  # Extract connection URL from .env
  $envContent = Get-Content ".env"
  $supabaseUrl = ($envContent | Where-Object { $_ -match "SUPABASE_URL=" }) -replace "SUPABASE_URL=", ""
  
  Write-Log "Connecting to Supabase: $supabaseUrl"
  
  # Apply SQL fixes using supabase CLI
  $tempFile = "temp-security-fixes.sql"
  $sqlContent | Out-File -FilePath $tempFile -Encoding UTF8
  
  Write-Log "Executing security fixes..."
  
  # Use supabase db shell to apply fixes
  $result = & supabase db shell --file $tempFile
  
  if ($LASTEXITCODE -eq 0) {
    Write-Log "✅ Security fixes applied successfully"
  } else {
    Write-Log "❌ Security fixes application failed"
    Write-Log "Error: $result"
  }
  
  # Clean up temp file
  if (Test-Path $tempFile) {
    Remove-Item $tempFile
  }
  
} catch {
  Write-Log "❌ Security fixes application failed: $($_.Exception.Message)"
  exit 1
}

Write-Log "Security fixes application process finished"
