<#
.SYNOPSIS
  frank/inventory.ps1 - read-only ground-truth inventory of the HYDI sprawl on Frank.
.DESCRIPTION
  Phase 0 deliverable. For every Hydi-looking folder under ~\ it records:
  git remote, branch, last commit date, dirty/clean, ahead/behind
  origin/clean-main, size on disk, and whether it is a git worktree.
  Also captures `pm2 jlist`, listening sockets for the ports in
  .ports.json, and the last 200 lines of each PM2 error log.

  STRICTLY READ-ONLY: no deletes, no stops, no writes outside the output
  directory. Safe on Windows PowerShell 5.1 and 7.

.PARAMETER Root
  Directory to scan for Hydi folders. Default: $env:USERPROFILE (C:\Users\Owner).

.PARAMETER OutDir
  Where inventory.json and inventory-summary.txt are written.
  Default: <Root>\hydi-inventory-<timestamp>\

.PARAMETER RepoHint
  Repository whose .ports.json supplies the port list.
  Default: <Root>\HYDI-System-v2\.ports.json

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank\inventory.ps1
#>
[CmdletBinding()]
param(
    [string]$Root = $env:USERPROFILE,
    [string]$OutDir,
    [string]$RepoHint = (Join-Path $env:USERPROFILE 'HYDI-System-v2')
)

$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutDir) { $OutDir = Join-Path $Root "hydi-inventory-$stamp" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Write-Section($obj, $name) {
    $obj | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutDir $name) -Encoding UTF8
}

# ---------- 1. Folder inventory ----------
$folderPattern = '*hydi*','*HYDI*','*HYPDI*','*protoforge*','*ProtoForge*','HY'
$dirs = Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $n = $_.Name; ($folderPattern | Where-Object { $n -like $_ }).Count -gt 0 }

$folders = foreach ($d in $dirs) {
    $entry = [ordered]@{
        name      = $d.Name
        path      = $d.FullName
        isGitRepo = $false
        isWorktree= $false
        remote    = $null
        branch    = $null
        lastCommit= $null
        dirty     = $null
        ahead     = $null
        behind    = $null
        sizeMB    = $null
        error     = $null
    }
    try {
        Push-Location -LiteralPath $d.FullName
        $top = & git rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $top) {
            $entry.isGitRepo = $true
            # worktree? .git is a file (gitdir pointer) in linked worktrees
            $gitPath = Join-Path $d.FullName '.git'
            if (Test-Path -LiteralPath $gitPath -PathType Leaf) { $entry.isWorktree = $true }
            $entry.remote     = (& git remote get-url origin 2>$null)
            $entry.branch     = (& git rev-parse --abbrev-ref HEAD 2>$null)
            $entry.lastCommit = (& git log -1 --format='%cI %h %s' 2>$null)
            $porcelain = & git status --porcelain --untracked-files=no 2>$null
            $entry.dirty = [bool]($porcelain | Where-Object { $_ })
            # ahead/behind vs origin/clean-main (best effort; fetch is NOT run)
            $ab = & git rev-list --left-right --count 'HEAD...origin/clean-main' 2>$null
            if ($ab -match '^\s*(\d+)\s+(\d+)\s*$') { $entry.ahead = [int]$Matches[1]; $entry.behind = [int]$Matches[2] }
        }
        Pop-Location
    } catch {
        $entry.error = $_.Exception.Message
        try { Pop-Location } catch {}
    }
    # size: sum of files, capped scan (skip .git internals cost is acceptable for ~55 dirs)
    try {
        $bytes = (Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
                  Measure-Object -Property Length -Sum).Sum
        $entry.sizeMB = [math]::Round(($bytes / 1MB), 1)
    } catch { $entry.sizeMB = $null }
    [pscustomobject]$entry
}

# ---------- 2. PM2 jlist ----------
# pm2 jlist emits env blobs with duplicate keys differing only by case
# (username/USERNAME), which breaks ConvertFrom-Json on PS 5.1. Pipe the
# raw JSON through node (always present - PM2 requires it) to slim it first.
$pm2Summary = @()
try {
    $raw = (& pm2 jlist 2>$null | Out-String)
    if ($raw -and $raw.Trim().Length -gt 2) {
        # NDJSON (one slim object per line) avoids the PS5.1 array-unwrap quirk
        # where a JSON array round-trips as a single nested collection.
        $slimJson = $raw | & node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d);(Array.isArray(a)?a:[]).forEach(p=>console.log(JSON.stringify({name:p.name,status:p.pm2_env&&p.pm2_env.status,pid:p.pid,restarts:p.pm2_env&&p.pm2_env.restart_time,cwd:p.pm2_env&&p.pm2_env.pm_cwd,script:p.pm2_env&&p.pm2_env.pm_exec_path,memMB:Math.round(((p.monit&&p.monit.memory)||0)/104857.6)/10,cpu:p.monit&&p.monit.cpu})))}catch(e){}})" 2>$null
        if ($slimJson) { $pm2Summary = @($slimJson | ForEach-Object { $_ | ConvertFrom-Json }) }
    }
} catch { $pm2Summary = @() }

# ---------- 3. Listening ports from .ports.json ----------
$ports = @()
$portsPath = Join-Path $RepoHint '.ports.json'
if (Test-Path -LiteralPath $portsPath) {
    try {
        $reg = Get-Content -LiteralPath $portsPath -Raw | ConvertFrom-Json
        $ports = foreach ($prop in $reg.services.PSObject.Properties) {
            [pscustomobject]@{ id = $prop.Name; port = $prop.Value.port; env_var = $prop.Value.env_var; external = [bool]$prop.Value.external }
        }
    } catch {}
}
# Port state comes from a real TCP connect (works in every context,
# including restricted shells where netstat shows a filtered view);
# netstat -ano supplies the owning PID/process when it is visible.
# netstat format: "TCP  local  foreign  LISTENING  pid".
$pidByPort = @{}
$procByPid = @{}
$netstatLines = & netstat -ano 2>$null | Select-String 'LISTENING'
foreach ($line in @($netstatLines)) {
    $cols = ($line.Line -split '\s+') | Where-Object { $_ }
    if ($cols.Count -lt 5) { continue }
    $local = $cols[1]
    if ($local -notmatch ':(\d+)$') { continue }
    $port = [int]$Matches[1]
    $pidNum = 0
    [void][int]::TryParse($cols[-1], [ref]$pidNum)
    if (-not $pidByPort.ContainsKey($port)) { $pidByPort[$port] = $pidNum }
    if ($pidNum -and -not $procByPid.ContainsKey($pidNum)) {
        $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
        $procByPid[$pidNum] = if ($proc) { $proc.ProcessName } else { $null }
    }
}
$listeners = @()
foreach ($svc in $ports) {
    $port = [int]$svc.port
    $open = $false
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        $open = $iar.AsyncWaitHandle.WaitOne(1500) -and $client.Connected
        $client.Close()
    } catch { $open = $false }
    $pidNum = if ($pidByPort.ContainsKey($port)) { $pidByPort[$port] } else { $null }
    $listeners += [pscustomobject]@{
        port      = $port
        service   = $svc.id
        listening = [bool]$open
        pid       = $pidNum
        process   = if ($pidNum) { $procByPid[$pidNum] } else { $null }
        address   = if ($open) { '127.0.0.1' } else { $null }
    }
}

# ---------- 4. PM2 error log tails ----------
$logDir = Join-Path $env:USERPROFILE '.pm2\logs'
$logTails = @()
if (Test-Path -LiteralPath $logDir) {
    Get-ChildItem -LiteralPath $logDir -Filter '*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'error|err' } |
        ForEach-Object {
            $tail = Get-Content -LiteralPath $_.FullName -Tail 200 -ErrorAction SilentlyContinue
            $logTails += [pscustomobject]@{
                file    = $_.Name
                sizeKB  = [math]::Round($_.Length / 1KB, 1)
                tail200 = ($tail -join "`n")
            }
        }
}

# ---------- 5. Write outputs ----------
$report = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    host        = $env:COMPUTERNAME
    root        = $Root
    repoHint    = $RepoHint
    folders     = @($folders)
    pm2         = @($pm2Summary)
    ports       = $ports
    listeners   = @($listeners)
    pm2ErrLogs  = @($logTails)
}
Write-Section $report 'inventory.json'

# readable summary
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("HYDI Frank inventory - $($report.generatedAt) on $($report.host)")
[void]$sb.AppendLine("Folders scanned: $($folders.Count) under $Root")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('== Git folders ==')
foreach ($f in ($folders | Where-Object { $_.isGitRepo } | Sort-Object name)) {
    $wt = if ($f.isWorktree) { ' [worktree]' } else { '' }
    $ab = if ($null -ne $f.ahead) { "ahead=$($f.ahead) behind=$($f.behind)" } else { 'no-upstream-data' }
    [void]$sb.AppendLine(("{0,-28} {1,-22} {2,-10} dirty={3} {4} {5}MB  {6}" -f $f.name, $f.branch, $f.lastCommit, $f.dirty, $ab, $f.sizeMB, $wt))
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('== Non-git folders ==')
foreach ($f in ($folders | Where-Object { -not $_.isGitRepo } | Sort-Object name)) {
    [void]$sb.AppendLine(("{0,-28} {1}MB" -f $f.name, $f.sizeMB))
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('== PM2 ==')
foreach ($p in ($pm2Summary | Sort-Object name)) {
    [void]$sb.AppendLine(("{0,-32} {1,-16} pid={2,-7} restarts={3,-4} {4}MB cpu={5}%" -f $p.name, $p.status, $p.pid, $p.restarts, $p.memMB, $p.cpu))
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('== Ports (.ports.json) ==')
foreach ($l in ($listeners | Sort-Object port)) {
    $state = if ($l.listening) { 'LISTENING' } else { 'closed' }
    $owner = if ($l.process) { $l.process } else { '-' }
    [void]$sb.AppendLine(("{0,-6} {1,-22} {2,-10} pid={3,-7} {4}" -f $l.port, $l.service, $state, $l.pid, $owner))
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine("PM2 error logs captured: $($logTails.Count) files (full tails in inventory.json)")

$summaryPath = Join-Path $OutDir 'inventory-summary.txt'
Set-Content -LiteralPath $summaryPath -Value $sb.ToString() -Encoding UTF8

Write-Host "Inventory written to $OutDir"
Write-Host "  inventory.json"
Write-Host "  inventory-summary.txt"
Write-Host "Folders: $($folders.Count) | git repos: $(@($folders | Where-Object isGitRepo).Count) | PM2 apps: $(@($pm2Summary).Count) | port rows: $(@($listeners).Count)"
