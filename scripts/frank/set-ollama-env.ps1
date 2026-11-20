<#
.SYNOPSIS
  Set USER-level Ollama memory env vars on Frank (read-only by default).
.DESCRIPTION
  Prints before/after values for:
    OLLAMA_FLASH_ATTENTION, OLLAMA_KV_CACHE_TYPE, OLLAMA_NUM_PARALLEL,
    OLLAMA_MAX_LOADED_MODELS, OLLAMA_KEEP_ALIVE

  Default is dry-run. Pass -Apply to write to the current user's environment.
  Does NOT restart Ollama — Jordan restarts the serve process manually after.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank\set-ollama-env.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank\set-ollama-env.ps1 -Apply
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$Target = [ordered]@{
    OLLAMA_FLASH_ATTENTION   = '1'
    OLLAMA_KV_CACHE_TYPE     = 'q8_0'
    OLLAMA_NUM_PARALLEL      = '1'
    OLLAMA_MAX_LOADED_MODELS = '1'
    OLLAMA_KEEP_ALIVE        = '10m'
}

function Get-UserEnvValue([string]$Name) {
    return [Environment]::GetEnvironmentVariable($Name, 'User')
}

Write-Host ''
Write-Host '=== Ollama USER env (MemoryOps headroom) ===' -ForegroundColor Cyan
if (-not $Apply) {
    Write-Host 'Mode: DRY RUN (default). Pass -Apply to persist.' -ForegroundColor Yellow
} else {
    Write-Host 'Mode: APPLY — writing User environment variables.' -ForegroundColor Green
}
Write-Host ''

$changes = 0
foreach ($entry in $Target.GetEnumerator()) {
    $name = $entry.Key
    $want = $entry.Value
    $before = Get-UserEnvValue $name
    if ([string]::IsNullOrEmpty($before)) { $before = '(unset)' }
    $after = $want
    $willChange = ($before -ne $want)

    Write-Host ("{0,-28} before={1}" -f $name, $before)
    Write-Host ("{0,-28} after ={1}" -f '', $after) -ForegroundColor $(if ($willChange) { 'Yellow' } else { 'Gray' })

    if ($Apply) {
        if ($PSCmdlet.ShouldProcess($name, "Set User env to $want")) {
            [Environment]::SetEnvironmentVariable($name, $want, 'User')
            $changes++
        }
    } elseif ($willChange) {
        $changes++
    }
    Write-Host ''
}

if ($Apply) {
    Write-Host "Applied $changes variable(s). Restart Ollama serve (tray or PM2 ollama-serve) yourself — this script does not restart anything." -ForegroundColor Green
} else {
    Write-Host "Would change $changes variable(s). Re-run with -Apply to persist." -ForegroundColor Yellow
}
Write-Host "After restart, verify: npm run doctor" -ForegroundColor Gray
Write-Host ''