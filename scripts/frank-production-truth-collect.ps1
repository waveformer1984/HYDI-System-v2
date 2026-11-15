#Requires -Version 5.1
<#
.SYNOPSIS
  Phase 1 — Frank/heidi-pc production truth collector (read-only).

.DESCRIPTION
  Collects PM2 inventory, service probes, CPU/RAM/disk (and GPU if present),
  Ollama model list, Tailscale status, and recent restart counts. Writes JSON
  under .runtime/production-truth/ for cloud agents or operators to attach to
  HEIDI operational autonomy missions.

  Does NOT restart services, mutate env, or approve actions.
  Never prints secret values — env var names from PM2 only.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/frank-production-truth-collect.ps1
#>
param(
  [string]$OutDir = '',
  [int]$Pm2JlistTimeoutSec = 120
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Root '.runtime\production-truth' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Invoke-Probe {
  param([string]$Url, [int]$TimeoutMs = 4000)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec ([math]::Ceiling($TimeoutMs / 1000)) -UseBasicParsing
    return @{ ok = $true; status = [int]$r.StatusCode }
  } catch {
    return @{ ok = $false; status = 0; error = $_.Exception.Message }
  }
}

function Get-Pm2Jlist {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'pm2'
  $psi.Arguments = 'jlist'
  $psi.WorkingDirectory = $Root
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  if (-not $p.WaitForExit($Pm2JlistTimeoutSec * 1000)) {
  try { $p.Kill() } catch {}
    return @{ ok = $false; error = 'pm2 jlist timeout'; apps = @() }
  }
  $raw = $p.StandardOutput.ReadToEnd()
  try {
    $apps = @($raw | ConvertFrom-Json)
    $sanitized = foreach ($a in $apps) {
      $envNames = @()
      if ($a.pm2_env -and $a.pm2_env.env) {
        $envNames = @($a.pm2_env.env.PSObject.Properties.Name)
      }
      @{
        name = $a.name
        status = $a.pm2_env.status
        pid = $a.pid
        restarts = $a.pm2_env.restart_time
        uptime_ms = $a.pm2_env.pm_uptime
        script = $a.pm2_env.pm_exec_path
        cwd = $a.pm2_env.pm_cwd
        env_key_count = $envNames.Count
        env_keys_sample = $envNames | Select-Object -First 40
      }
    }
    return @{ ok = $true; apps = $sanitized }
  } catch {
    return @{ ok = $false; error = 'pm2 jlist parse failed'; apps = @() }
  }
}

$probes = @(
  @{ name = 'heidi-web'; url = 'http://127.0.0.1:3000/api/ping' },
  @{ name = 'heidi-web-health'; url = 'http://127.0.0.1:3000/api/health' },
  @{ name = 'heidi-core'; url = 'http://127.0.0.1:3459/health' },
  @{ name = 'heidi-mobile'; url = 'http://127.0.0.1:3006/api/health' },
  @{ name = 'protoforge-core'; url = 'http://127.0.0.1:3005/health' },
  @{ name = 'ollama'; url = 'http://127.0.0.1:11434/api/tags' }
)

$probeResults = foreach ($p in $probes) {
  $r = Invoke-Probe -Url $p.url
  @{ name = $p.name; url = $p.url; ok = $r.ok; status = $r.status; error = $r.error }
}

$mem = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1

$diskC = $null
try {
  $diskC = Get-PSDrive -Name C | Select-Object Used, Free
} catch {}

$gpu = $null
try {
  $nv = & nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader 2>$null
  if ($nv) { $gpu = @($nv) }
} catch {}

$tailscale = $null
try {
  $ts = & tailscale status --json 2>$null
  if ($ts) {
    $tj = $ts | ConvertFrom-Json
    $tailscale = @{
      backend_state = $tj.BackendState
      self = $tj.Self.Online
      peer_count = @($tj.Peer).Count
    }
  }
} catch {}

$authFlags = @{
  HYDI_MOBILE_TOKEN = [bool]$env:HYDI_MOBILE_TOKEN
  HEIDI_MOBILE_REQUIRE_TOKEN = $env:HEIDI_MOBILE_REQUIRE_TOKEN
  HYDI_ALLOW_PAID_LLM = $env:HYDI_ALLOW_PAID_LLM
  HEIDI_AUTONOMOUS_ACTIONS = $env:HEIDI_AUTONOMOUS_ACTIONS
  HEIDI_AUTO_APPROVE_RESTARTS = $env:HEIDI_AUTO_APPROVE_RESTARTS
}

$payload = @{
  schema_version = 1
  collected_at = (Get-Date).ToUniversalTime().ToString('o')
  host = $env:COMPUTERNAME
  repo_root = $Root
  git_head = $(try { git -C $Root rev-parse HEAD 2>$null } catch { $null })
  git_branch = $(try { git -C $Root rev-parse --abbrev-ref HEAD 2>$null } catch { $null })
  pm2 = Get-Pm2Jlist
  probes = $probeResults
  resources = @{
    cpu_name = $cpu.Name
    logical_processors = $cpu.NumberOfLogicalProcessors
    total_ram_gb = [math]::Round($mem.TotalVisibleMemorySize / 1MB, 2)
    free_ram_gb = [math]::Round($mem.FreePhysicalMemory / 1MB, 2)
    disk_c_used_gb = if ($diskC) { [math]::Round($diskC.Used / 1GB, 2) } else { $null }
    disk_c_free_gb = if ($diskC) { [math]::Round($diskC.Free / 1GB, 2) } else { $null }
    gpu = $gpu
  }
  tailscale = $tailscale
  auth_flags = $authFlags
  notes = @(
    'Attach this file to Cursor agent runs; do not commit if it contains sensitive paths.',
    'Complement with: node scripts/heidi-assessment-crew.js --dry-run'
  )
}

$outFile = Join-Path $OutDir ("frank-production-truth-{0}.json" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
$payload | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $outFile
Write-Output $outFile