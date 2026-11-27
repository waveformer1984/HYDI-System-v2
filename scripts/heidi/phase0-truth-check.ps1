# Devin runs this on Frank, not Cursor.
# Read-only Phase 0 truth check: PM2 snapshot, port listeners, heidi_* row counts.
# Does not stop, start, or mutate services.

$ErrorActionPreference = 'Stop'
$ReportDir = 'C:\ProtoForge_Ecosystem\logs'
$ReportPath = Join-Path $ReportDir 'phase0-report.md'
$RepoRoot = if ($env:HYDI_REPO) { $env:HYDI_REPO } else { 'C:\Users\Owner\HYDI-System-v2' }
$Ports = @(3000, 3005, 3006, 3456, 3459, 11434)
$Tables = @('heidi_state_snapshots', 'heidi_events', 'heidi_reflections', 'heidi_decision_bounds')

function Get-Pm2Json {
    try {
        $raw = & pm2 jlist 2>$null
        if (-not $raw) { return $null }
        $start = $raw.IndexOf('[')
        if ($start -lt 0) { return $null }
        return $raw.Substring($start) | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Test-PortListening([int]$Port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        return [bool]$c
    } catch {
        return $false
    }
}

function Get-TableCount($BaseUrl, $Key, $Table) {
    if (-not $BaseUrl -or -not $Key) { return @{ ok = $false; detail = 'SUPABASE env missing' } }
    try {
        $uri = "$BaseUrl/rest/v1/$Table`?select=id&limit=1"
        $headers = @{
            apikey = $Key
            Authorization = "Bearer $Key"
            Prefer = 'count=exact'
        }
        $r = Invoke-WebRequest -Uri $uri -Headers $headers -Method Head -TimeoutSec 10 -UseBasicParsing
        $range = $r.Headers['Content-Range']
        if ($range -match '/(\d+)$') { return @{ ok = $true; count = [int]$Matches[1] } }
        return @{ ok = $true; count = 'unknown'; detail = $range }
    } catch {
        return @{ ok = $false; detail = $_.Exception.Message }
    }
}

$ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + 'Z'
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# Phase 0 truth check")
$lines.Add("")
$lines.Add("- Generated: $ts")
$lines.Add("- Repo: $RepoRoot")
$lines.Add("- Mode: read-only")
$lines.Add("")

$pm2 = Get-Pm2Json
$lines.Add("## PM2 (`pm2 jlist`)")
if ($null -eq $pm2) {
    $lines.Add("PM2 jlist: **unreadable**")
} else {
    $lines.Add("| name | status | restarts |")
    $lines.Add("|---|---|---|")
    foreach ($p in $pm2) {
        $env = $p.pm2_env
        $lines.Add("| $($p.name) | $($env.status) | $($env.restart_time) |")
    }
}

$lines.Add("")
$lines.Add("## Ports")
$lines.Add("| port | listening |")
$lines.Add("|---|---|")
foreach ($port in $Ports) {
    $up = Test-PortListening $port
    $flag = ''
    if ($port -eq 3006) { $flag = ' (legacy heidi-mobile-chat)' }
    if ($port -eq 3456) { $flag = ' **(old heidi-core name — expect closed)**' }
    $lines.Add("| $port | $(if ($up) { 'yes' } else { 'no' })$flag |")
}

$sbUrl = $env:SUPABASE_URL
$sbKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $sbKey) { $sbKey = $env:SUPABASE_ANON_KEY }

$lines.Add("")
$lines.Add("## Supabase table counts")
$lines.Add("| table | count |")
$lines.Add("|---|---|")
foreach ($t in $Tables) {
    $r = Get-TableCount $sbUrl $sbKey $t
    if ($r.ok) { $lines.Add("| $t | $($r.count) |") }
    else { $lines.Add("| $t | error: $($r.detail) |") }
}

$lines.Add("")
$lines.Add("## Notes")
$lines.Add("- 3000 = heidi-web-standalone (canonical phone path)")
$lines.Add("- 3459 = heidi-core")
$lines.Add("- 3456 is not in port registry; closed is healthy")

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
}
$lines -join "`n" | Set-Content -Path $ReportPath -Encoding utf8
Write-Host "Wrote $ReportPath"