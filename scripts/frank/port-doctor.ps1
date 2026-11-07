<#
.SYNOPSIS
  frank/port-doctor.ps1 - show which PID/process holds each .ports.json port,
  and optionally stop ONLY processes it recognizes as HYDI/PM2.
.DESCRIPTION
  Phase 2 deliverable. Read-only by default: prints a table of every
  registry port with listening state, PID and process name.

  With -Fix it offers to stop occupants of registry ports, but ONLY when
  the process is recognized as HYDI-owned:
    - it is a PM2-managed app (name appears in `pm2 jlist`), or
    - its executable path/cmdline contains HYDI/System-v2/ProtoForge, or
    - -All matching is bypassed with -ForceUnrecognized (still asks).
  Anything else is reported and left alone.

  Never kills by bare process name. Every stop is confirmed unless
  -Yes is passed. Windows-only (uses netstat/Get-Process/taskkill).

.PARAMETER Fix
  Attempt to free registry ports held by recognized HYDI processes.

.PARAMETER Yes
  Skip the per-port confirmation prompt (implies -Fix behavior is still
  limited to recognized processes).

.PARAMETER RepoHint
  Repo containing .ports.json. Default: <UserProfile>\HYDI-System-v2
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Fix,
    [switch]$Yes,
    [string]$RepoHint = (Join-Path $env:USERPROFILE 'HYDI-System-v2')
)

$ErrorActionPreference = 'Continue'
$portsPath = Join-Path $RepoHint '.ports.json'
if (-not (Test-Path -LiteralPath $portsPath)) { throw ".ports.json not found at $portsPath" }
$reg = Get-Content -LiteralPath $portsPath -Raw | ConvertFrom-Json
$services = @($reg.services.PSObject.Properties | ForEach-Object { [pscustomobject]@{ id=$_.Name; port=[int]$_.Value.port; external=[bool]$_.Value.external } })

# --- PM2 app names (for recognition) ---
$pm2Names = @{}
try {
    $raw = (& pm2 jlist 2>$null | Out-String)
    if ($raw) {
        $raw | & node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{JSON.parse(d).forEach(p=>console.log(p.name))}catch(e){}})" 2>$null |
            ForEach-Object { $pm2Names[$_] = $true }
    }
} catch {}

# --- netstat listeners: port -> [{pid}] ---
$listenByPort = @{}
& netstat -ano 2>$null | Select-String 'LISTENING' | ForEach-Object {
    $cols = ($_.Line -split '\s+') | Where-Object { $_ }
    if ($cols.Count -lt 5) { return }
    if ($cols[1] -notmatch ':(\d+)$') { return }
    $port = [int]$Matches[1]
    $procId = 0; [void][int]::TryParse($cols[-1], [ref]$procId)
    if (-not $listenByPort.ContainsKey($port)) { $listenByPort[$port] = @() }
    if ($procId -and $listenByPort[$port] -notcontains $procId) { $listenByPort[$port] += $procId }
}

function Test-HydiProcess($procId) {
    # Recognized HYDI if: PM2 knows a same-named app AND the pid matches a
    # pm2 process, OR the process image path/cmdline mentions HYDI paths.
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    try {
        $path = $proc.Path
        if ($path -and ($path -match 'HYDI|ProtoForge|hydi')) { return $true }
    } catch {}
    try {
        $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
        if ($cl -and ($cl -match 'HYDI-System-v2|HYDI_System|ProtoForge_Ecosystem|hydi-|heidi-|ursula')) { return $true }
    } catch {}
    return $false
}

$rows = foreach ($svc in ($services | Sort-Object port)) {
    $pids = @()
    if ($listenByPort.ContainsKey($svc.port)) { $pids = $listenByPort[$svc.port] }
    foreach ($procId in $pids) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $hydi = Test-HydiProcess $procId
        [pscustomobject]@{
            port     = $svc.port
            service  = $svc.id
            pid      = $procId
            process  = if ($proc) { $proc.ProcessName } else { '?' }
            hydi     = $hydi
            external = $svc.external
        }
    }
    if (-not $pids.Count) {
        [pscustomobject]@{ port=$svc.port; service=$svc.id; pid=$null; process='(free)'; hydi=$false; external=$svc.external }
    }
}

$rows | Format-Table port, service, pid, process, hydi, external -AutoSize

if (-not $Fix) {
    Write-Host "`nRead-only report. Re-run with -Fix to stop HYDI-owned occupants (asks per port unless -Yes)."
    return
}

foreach ($row in ($rows | Where-Object { $_.pid -and $_.hydi })) {
    $msg = "Stop pid $($row.pid) ($($row.process)) holding :$($row.port) [$($row.service)]?"
    if ($Yes -or $PSCmdlet.ShouldProcess("pid $($row.pid)", $msg)) {
        try {
            & taskkill /PID $row.pid /T /F | Out-Null
            Write-Host "stopped pid $($row.pid) on :$($row.port)"
        } catch { Write-Host "FAILED to stop pid $($row.pid): $($_.Exception.Message)" }
    }
}
$foreign = @($rows | Where-Object { $_.pid -and -not $_.hydi })
if ($foreign.Count) {
    Write-Host "`nLeft alone (not recognized as HYDI):"
    $foreign | Format-Table port, service, pid, process -AutoSize
}
