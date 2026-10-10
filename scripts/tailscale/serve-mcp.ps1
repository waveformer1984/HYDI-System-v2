<#
.SYNOPSIS
    Expose the protoforge MCP server to the tailnet (tailnet-only, never public).
    Idempotent: safe to re-run. Run on the HYDI PC from the repo.

.DESCRIPTION
    1. Ensures PROTOFORGE_MCP_TOKEN exists in .env.local (generated straight
       into the file; the value is never displayed).
    2. Ensures mcp\protoforge-mcp dependencies are installed.
    3. Registers a per-user logon Scheduled Task "ProtoForge MCP HTTP" that runs
       scripts\tailscale\run-mcp-http.cmd (same pattern as the
       "HYDI Boot Agent" task), and starts it.
    4. Runs `tailscale serve --bg --https=8470 http://127.0.0.1:3470`.
       This leaves the existing 443 -> :3000 heidi-web serve untouched.
    5. Verifies: /healthz answers, and /mcp without a token returns 401.

    Never uses Tailscale Funnel. Nothing here is reachable from the internet.

.PARAMETER Remove
    Roll back: turn off the 8470 serve and unregister the scheduled task.
    Leaves the token in .env.local and every other serve (e.g. heidi-web) alone.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\serve-mcp.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\tailscale\serve-mcp.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$TaskName  = 'ProtoForge MCP HTTP'
$ServePort = 8470
$LocalPort = 3470
$ScriptDir = $PSScriptRoot
$Root      = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$Wrapper   = Join-Path $ScriptDir 'run-mcp-http.cmd'
$McpDir    = Join-Path $Root 'mcp\protoforge-mcp'
$EnvLocal  = Join-Path $Root '.env.local'

function Need($cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' not found on PATH." }
}
Need tailscale

if ($Remove) {
    & tailscale serve --https=$ServePort off 2>$null
    Write-Host "Turned off tailscale serve on :$ServePort (other serves untouched)." -ForegroundColor Green
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
    }
    return
}

Need node
if (-not (Test-Path $Wrapper)) { throw "Wrapper not found: $Wrapper" }

# 1. Token: presence check only; generate into the file if missing.
$hasToken = (Test-Path $EnvLocal) -and (Select-String -Path $EnvLocal -Pattern '^\s*PROTOFORGE_MCP_TOKEN\s*=\s*\S+' -Quiet)
if ($hasToken) {
    Write-Host "PROTOFORGE_MCP_TOKEN: present in .env.local"
} else {
    $line = & node -e "process.stdout.write('PROTOFORGE_MCP_TOKEN='+require('crypto').randomBytes(32).toString('hex'))"
    Add-Content -Path $EnvLocal -Value ("`n" + $line)
    Remove-Variable line
    Write-Host "PROTOFORGE_MCP_TOKEN: generated into .env.local (value not shown)" -ForegroundColor Green
}

# 2. Dependencies.
if (-not (Test-Path (Join-Path $McpDir 'node_modules'))) {
    Write-Host "Installing protoforge-mcp dependencies..."
    Push-Location $McpDir; try { & npm install --no-audit --no-fund | Out-Null } finally { Pop-Location }
}

# 3. Logon task (no admin needed), then start it.
$action    = New-ScheduledTaskAction -Execute $Wrapper -WorkingDirectory $Root
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$listening = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 3
}

# 4. Tailnet-only HTTPS serve on 8470 (443 stays heidi-web).
$serveOut = & tailscale serve --bg --https=$ServePort "http://127.0.0.1:$LocalPort" 2>&1
if ($LASTEXITCODE -ne 0) {
    # Native-command failures don't trip $ErrorActionPreference; check explicitly
    # so a healthy local server can't mask a missing tailnet endpoint.
    throw "tailscale serve failed (exit $LASTEXITCODE): $($serveOut -join ' ')"
}

# 5. Verify locally.
$ok = $true
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/healthz" -TimeoutSec 5
    Write-Host "healthz: ok ($($h.name) v$($h.version))" -ForegroundColor Green
} catch { $ok = $false; Write-Host "healthz: FAILED -- see logs\protoforge-mcp.log" -ForegroundColor Red }
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/mcp" -Method Post -Body '{}' -ContentType 'application/json' -TimeoutSec 5 | Out-Null
    $ok = $false; Write-Host "auth: FAILED -- /mcp answered without a token" -ForegroundColor Red
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { Write-Host "auth: ok (401 without token)" -ForegroundColor Green }
    else { $ok = $false; Write-Host "auth: unexpected status $code" -ForegroundColor Red }
}

$dns = (& tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
Write-Host ""
Write-Host "Tailnet endpoint: https://$dns`:$ServePort/mcp  (Authorization: Bearer <PROTOFORGE_MCP_TOKEN>)"
& tailscale serve status
if (-not $ok) { exit 1 }
