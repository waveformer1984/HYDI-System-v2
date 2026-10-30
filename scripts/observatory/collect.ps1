# HYDI Hardware & Runtime Observatory - collector
# Read-only: CIM/WMI, docker CLI, pm2 jlist (via pm2_sanitizer.js), TCP/HTTP
# probes. No writes to the monitored system. Appends JSONL telemetry and
# atomically rewrites current.json under <repo>/.observatory/.
#
# Usage:  collect.ps1 -Once            (one sample - Task Scheduler cadence)
#         collect.ps1 -IntervalSec 60  (run-forever loop, not used by scheduler)
param(
  [switch]$Once,
  [int]$IntervalSec = 60,
  [switch]$Quiet,
  # Sanitized PM2 list written by frank-observer this pass. When given, this
  # script does not run its own `pm2 jlist` (one jlist per pass, not three).
  [string]$Pm2Snapshot = ''
)

$ErrorActionPreference = 'Continue'
$ROOT = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$OBS  = Join-Path $ROOT '.observatory'
$SCHEMA = 'observatory-sample/1'
$RETENTION_DAYS = 14

if (-not (Test-Path $OBS)) { New-Item -ItemType Directory -Force $OBS | Out-Null }

$Utf8NoBom = New-Object Text.UTF8Encoding($false)

function Write-AtomicJson($path, $obj) {
  $tmp = "$path.tmp"
  [IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Depth 8), $Utf8NoBom)
  Move-Item -Force -Path $tmp -Destination $path
}

function Append-Jsonl($path, $obj) {
  [IO.File]::AppendAllText($path, ($obj | ConvertTo-Json -Depth 8 -Compress) + "`n", $Utf8NoBom)
}

function Get-PrevSnapshot {
  $p = Join-Path $OBS 'current.json'
  if (Test-Path $p) {
    try { return (Get-Content $p -Raw | ConvertFrom-Json) } catch { return $null }
  }
  return $null
}

function New-Finding($id, $subject, $class, $severity, $summary, $value, $action, $approval, $impact) {
  [ordered]@{
    id         = $id
    subject    = $subject
    class      = $class        # MEASURED | DERIVED | HYPOTHESIS
    severity   = $severity     # info | warn | crit
    summary    = $summary
    value      = $value
    confidence = [ordered]@{ level = 'high'; basis = 'direct measurement from collector sample' }
    impact     = $impact
    recommendation = [ordered]@{
      action           = $action
      approval_level   = $approval    # none-needed | operator | owner
      reversible       = $true
      rollback         = 'revert the applied change; observer records before/after'
      success_criteria = 'metric returns inside threshold on subsequent samples'
      verification     = 'compare post-change samples against baseline evidence'
    }
  }
}

function Invoke-Collect {
  $t0 = Get-Date
  $errors = @()
  $rec = [ordered]@{ schema = $SCHEMA; ts = $t0.ToUniversalTime().ToString('o'); collect_ms = 0; errors = $errors }

  # ---- HOST ----
  try {
    $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
    $os   = Get-CimInstance Win32_OperatingSystem
    $mem  = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    $pf   = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1
    $vols = Get-Volume | Where-Object { $_.DriveLetter -and $_.Size -gt 0 } |
            ForEach-Object { [ordered]@{ drive = $_.DriveLetter; label = $_.FileSystemLabel; total_gb = [math]::Round($_.Size/1GB,1); free_gb = [math]::Round($_.SizeRemaining/1GB,1); health = [string]$_.HealthStatus } }
    $top  = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 |
            ForEach-Object { [ordered]@{ name = $_.ProcessName; pid = $_.Id; ws_mb = [math]::Round($_.WorkingSet64/1MB) } }
    $rec.host = [ordered]@{
      cpu_pct           = $cpu.LoadPercentage
      cpu_mhz           = $cpu.CurrentClockSpeed
      mem_total_mb      = [math]::Round($os.TotalVisibleMemorySize/1KB)
      mem_avail_mb      = [math]::Round($os.FreePhysicalMemory/1KB)
      commit_bytes      = [int64]$mem.CommittedBytes
      commit_limit      = [int64]$mem.CommitLimit
      commit_pct        = [math]::Round(100*$mem.CommittedBytes/$mem.CommitLimit,1)
      pagefile_alloc_mb = if ($pf) { $pf.AllocatedBaseSize } else { $null }
      pagefile_used_mb  = if ($pf) { $pf.CurrentUsage } else { $null }
      pagefile_peak_mb  = if ($pf) { $pf.PeakUsage } else { $null }
      uptime_hours      = [math]::Round(((Get-Date)-$os.LastBootUpTime).TotalHours,1)
      disks             = @($vols)
      top_procs         = @($top)
    }
  } catch { $errors += "host: $($_.Exception.Message)" }

  # ---- GPU + SENSORS (honest unavailable) ----
  try {
    $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
    $engines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop |
               Group-Object { if ($_.Name -match 'engtype_(\w+)$') { $Matches[1] } else { 'other' } } |
               ForEach-Object { [ordered]@{ engine = $_.Name; util_pct = ($_.Group | Measure-Object UtilizationPercentage -Sum).Sum } }
    $rec.gpu = [ordered]@{ available = $true; name = $gpu.Name; driver = $gpu.DriverVersion; status = $gpu.Status; engines = @($engines) }
  } catch { $rec.gpu = [ordered]@{ available = $false; reason = $_.Exception.Message } }
  try {
    $tz = Get-CimInstance -Namespace 'root\wmi' -ClassName MSAcpi_ThermalZoneTemperature -OperationTimeoutSec 3 -ErrorAction Stop
    $rec.sensors = [ordered]@{ temps_available = ($null -ne $tz); temps_c = @($tz | ForEach-Object { [math]::Round(($_.CurrentTemperature/10)-273.15,1) }); fans_available = $false; source = 'MSAcpi_ThermalZoneTemperature' }
  } catch { $rec.sensors = [ordered]@{ temps_available = $false; fans_available = $false; reason = 'no accessible sensor namespace without vendor/driver tooling'; deferred_to = 'LibreHardwareMonitor (separate approval)' } }

  # ---- DOCKER ----
  try {
    $psOut = docker ps -a --format '{{json .}}' 2>$null
    if ($LASTEXITCODE -ne 0) { throw "docker ps exit $LASTEXITCODE" }
    $stats = @{}
    try { docker stats --no-stream --format '{{json .}}' 2>$null | ForEach-Object { $s = $_ | ConvertFrom-Json; $stats[$s.Name] = $s } } catch { $errors += "docker-stats: $($_.Exception.Message)" }
    $rest  = @{}
    try {
      $ids = docker ps -aq 2>$null
      if ($ids) { docker inspect $ids --format '{{.Name}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>$null | ForEach-Object { $p = $_ -split '\|'; $rest[$p[0].TrimStart('/')] = @{ restarts = [int]$p[1]; health = $p[2] } } }
    } catch { $errors += "docker-inspect: $($_.Exception.Message)" }
    $vmMb = $null
    try { $vmMb = [math]::Round([int64](docker system info --format '{{.MemTotal}}' 2>$null)/1MB) } catch {}
    $containers = @($psOut | ForEach-Object {
      $c = $_ | ConvertFrom-Json
      $n = $c.Names
      [ordered]@{
        id = $c.ID; name = $n; image = $c.Image; status = $c.Status; state = $c.State; ports = $c.Ports
        restarts = if ($rest[$n]) { $rest[$n].restarts } else { $null }
        health   = if ($rest[$n]) { $rest[$n].health } else { $null }
        cpu_pct  = if ($stats[$n]) { $stats[$n].CPUPerc } else { $null }
        mem      = if ($stats[$n]) { $stats[$n].MemUsage } else { $null }
      }
    })
    $rec.docker = [ordered]@{ available = $true; wsl_vm_mem_mb = $vmMb; containers = $containers }
  } catch { $rec.docker = [ordered]@{ available = $false; reason = $_.Exception.Message } }

  # ---- PM2 ----
  try {
    # pm2 jlist embeds env objects with duplicate keys under case-insensitive
    # JSON parsing (username/USERNAME) - reduce via node sanitizer, which also
    # strips all process environment values out of telemetry.
    $sanitizer = Join-Path $PSScriptRoot 'pm2_sanitizer.js'
    $jl = $null
    if ($Pm2Snapshot) {
      if (-not (Test-Path $Pm2Snapshot)) { throw 'shared PM2 snapshot missing (frank-observer)' }
      $snap = Get-Content -Raw -Path $Pm2Snapshot | ConvertFrom-Json
      if (-not $snap.available) { throw "pm2 jlist unreadable this pass: $($snap.reason)" }
      $jl = @($snap.processes)
    }
    elseif ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $sanitizer)) {
      $reduced = pm2 jlist 2>$null | node $sanitizer 2>$null
      if ($LASTEXITCODE -eq 0 -and $reduced) { $jl = $reduced | ConvertFrom-Json }
    }
    if (-not $jl -and -not $Pm2Snapshot) {
      # fallback: raw jlist parse - may hit the duplicate-key crash; caught below
      $raw = pm2 jlist 2>$null
      if ($raw) { $jl = $raw | ConvertFrom-Json | ForEach-Object { [ordered]@{ name = $_.name; pid = $_.pid; status = $_.pm2_env.status; restarts = $_.pm2_env.restart_time; uptime_ms = $_.pm2_env.pm_uptime; mem_bytes = $_.monit.memory; cpu_pct = $_.monit.cpu } } }
    }
    if (-not $jl) { throw 'pm2 jlist unavailable or unparseable' }
    $rec.pm2 = [ordered]@{ available = $true; processes = @($jl | ForEach-Object {
      [ordered]@{
        name = $_.name; pid = $_.pid; status = $_.status
        restarts = $_.restarts
        uptime_min = if ($_.uptime_ms) { [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $_.uptime_ms)/60000) } else { $null }
        mem_mb = [math]::Round(($_.mem_bytes)/1MB,1)
        cpu_pct = $_.cpu_pct
      }
    }) }
  } catch { $rec.pm2 = [ordered]@{ available = $false; reason = $_.Exception.Message } }

  # ---- OLLAMA (read-only API probes; no inference triggered) ----
  try {
    $v  = Invoke-RestMethod -Uri 'http://localhost:11434/api/version' -TimeoutSec 3
    $ps = Invoke-RestMethod -Uri 'http://localhost:11434/api/ps' -TimeoutSec 3
    $rec.ollama = [ordered]@{ reachable = $true; version = $v.version; models_loaded = @($ps.models | ForEach-Object { [ordered]@{ name = $_.name; vram_mb = [math]::Round($_.size_vram/1MB); expires_at = $_.expires_at } }) }
  } catch { $rec.ollama = [ordered]@{ reachable = $false; reason = $_.Exception.Message } }

  # ---- PROBES (TCP + one HTTP health; no credentials used or printed) ----
  $probes = [ordered]@{}
  foreach ($pp in @(@{n='db_tcp_54322'; h='127.0.0.1'; p=54322}, @{n='kong_54321'; h='127.0.0.1'; p=54321}, @{n='web_3000'; h='127.0.0.1'; p=3000}, @{n='ollama_11434'; h='127.0.0.1'; p=11434})) {
    try {
      $c = New-Object Net.Sockets.TcpClient
      $iar = $c.BeginConnect($pp.h, $pp.p, $null, $null)
      $probes[$pp.n] = $iar.AsyncWaitHandle.WaitOne(600) -and $c.Connected
      $c.Close()
    } catch { $probes[$pp.n] = $false }
  }
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $h = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 4
    $sw.Stop()
    $probes.web_health = [ordered]@{ reachable = $true; ms = $sw.ElapsedMilliseconds; status = $h.status }
  } catch { $probes.web_health = [ordered]@{ reachable = $false; reason = 'api/health probe failed' } }
  $rec.probes = $probes
  $rec.notes = 'db probe = TCP reachability of published port 54322; container running/reachable/configured-db are distinct claims; only reachability is measured here.'

  $rec.collect_ms = [int]((Get-Date) - $t0).TotalMilliseconds
  return $rec
}

function Invoke-Findings($rec, $prev) {
  $active = @{}
  $ev = "telemetry_$( ([DateTime]$rec.ts).ToUniversalTime().ToString('yyyy-MM-dd') ).jsonl"
  function F($id,$subject,$class,$sev,$summary,$value,$action,$approval,$impact) {
    $active[$id] = New-Finding $id $subject $class $sev $summary $value $action $approval $impact
  }

  if ($rec.host) {
    $h = $rec.host
    if ($h.mem_avail_mb -lt 800)        { F 'host-mem-crit' 'physical_memory' 'MEASURED' 'crit' "only $([math]::Round($h.mem_avail_mb/1KB,2)) GB physical RAM free" "$($h.mem_avail_mb)MB" 'review top_procs; consider PM2 max_memory_restart limits' 'operator' 'OOM risk; paging stalls under load' }
    elseif ($h.mem_avail_mb -lt 1536)   { F 'host-mem-warn' 'physical_memory' 'MEASURED' 'warn' "low free RAM: $([math]::Round($h.mem_avail_mb/1KB,2)) GB" "$($h.mem_avail_mb)MB" 'monitor; identify growing consumers' 'operator' 'elevated paging; latency under bursts' }
    if ($h.commit_pct -gt 92)           { F 'host-commit-crit' 'commit' 'MEASURED' 'crit' "commit $($h.commit_pct)% of limit" "$($h.commit_pct)%" 'reduce working set or raise commit limit (pagefile)' 'owner' 'allocation failures; process crashes' }
    elseif ($h.commit_pct -gt 85)       { F 'host-commit-warn' 'commit' 'MEASURED' 'warn' "commit $($h.commit_pct)%" "$($h.commit_pct)%" 'watch commit trend; correlate with PM2/docker growth' 'operator' 'approaching commit ceiling' }
    foreach ($d in $h.disks) {
      if ($d.drive -eq 'C' -and $d.free_gb -lt 8)  { F 'disk-c-crit' 'disk:C' 'MEASURED' 'crit' "C: $($d.free_gb) GB free" "$($d.free_gb)GB" 'space audit; relocate large logs/artifacts' 'owner' 'writes may fail; DB/docker corruption risk' }
      elseif ($d.drive -eq 'C' -and $d.free_gb -lt 15) { F 'disk-c-warn' 'disk:C' 'MEASURED' 'warn' "C: $($d.free_gb) GB free (~3%)" "$($d.free_gb)GB" 'inventory largest dirs under repo, docker, node caches' 'operator' 'limited headroom for logs/backups' }
      if ($d.health -and $d.health -ne 'Healthy') { F "disk-$($d.drive)-health" "disk:$($d.drive)" 'MEASURED' 'warn' "$($d.drive): HealthStatus=$($d.health)" $d.health 'passive SMART/health probe' 'operator' 'possible removable-media degradation' }
    }
  }
  if (-not $rec.docker.available) { F 'docker-down' 'docker' 'MEASURED' 'warn' "docker CLI query failed" $rec.docker.reason 'check Docker Desktop/WSL state (read-only)' 'operator' 'blind to container health' }
  elseif ($prev -and $prev.docker -and $prev.docker.available) {
    $prevR = @{}; $prev.docker.containers | ForEach-Object { $prevR[$_.name] = $_.restarts }
    foreach ($c in $rec.docker.containers) {
      if ($null -ne $c.restarts -and $prevR.ContainsKey($c.name) -and $null -ne $prevR[$c.name] -and $c.restarts -gt $prevR[$c.name]) {
        F "container-restart-$($c.name)" "docker:$($c.name)" 'MEASURED' 'warn' "$($c.name) restart $($prevR[$c.name])->$($c.restarts)" $c.restarts 'inspect container logs for crash cause' 'operator' 'service flapping'
      }
    }
  }
  if ($rec.pm2 -and $rec.pm2.available -and $prev -and $prev.pm2 -and $prev.pm2.available) {
    $prevR2 = @{}; $prev.pm2.processes | ForEach-Object { $prevR2[$_.name] = $_.restarts }
    foreach ($p in $rec.pm2.processes) {
      if ($prevR2.ContainsKey($p.name) -and $p.restarts -gt $prevR2[$p.name]) {
        F "pm2-restart-$($p.name)" "pm2:$($p.name)" 'MEASURED' 'warn' "$($p.name) restarts $($prevR2[$p.name])->$($p.restarts)" $p.restarts 'inspect pm2 logs; check restart backoff' 'operator' 'process instability'
      }
    }
  }
  foreach ($k in $rec.probes.Keys) {
    $v = $rec.probes[$k]
    if ($k -eq 'web_health') { if (-not $v.reachable) { F "probe-$k" "probe:$k" 'MEASURED' 'warn' "web health endpoint unreachable" 'down' 'check heidi-web-standalone and next server state' 'operator' 'HYDI control surface degraded' } }
    elseif ($v -eq $false) { F "probe-$k" "probe:$k" 'MEASURED' 'warn' "$k not listening" 'down' 'verify owning container/process' 'operator' 'dependency may be down' }
  }
  if ($rec.ollama -and $rec.ollama.reachable -eq $false) { F 'ollama-down' 'ollama' 'MEASURED' 'warn' 'ollama API unreachable' $rec.ollama.reason 'check ollama process' 'operator' 'embedding/inference unavailable' }

  # telemetry-gap self-check
  if ($prev -and $prev.ts) {
    $gap = ([DateTime]$rec.ts - [DateTime]$prev.ts).TotalSeconds
    if ($gap -gt ($IntervalSec * 3)) { F 'telemetry-gap' 'collector' 'DERIVED' 'info' "sample gap $([math]::Round($gap))s exceeds 3x interval" "$([math]::Round($gap))s" 'check scheduled task last-run result' 'operator' 'evidence completeness reduced' }
  }

  # transitions vs previous active set
  $prevActive = @{}
  if ($prev -and $prev.findings_active) { $prev.findings_active | ForEach-Object { $prevActive[$_.id] = $_ } }
  $events = @()
  foreach ($id in $active.Keys) {
    if (-not $prevActive.ContainsKey($id)) { $events += [ordered]@{ event = 'raised'; id = $id; ts = $rec.ts; finding = $active[$id]; evidence_ref = $ev } }
    elseif ($prevActive[$id].severity -ne $active[$id].severity) { $events += [ordered]@{ event = 'severity_changed'; id = $id; ts = $rec.ts; finding = $active[$id]; evidence_ref = $ev } }
  }
  foreach ($id in $prevActive.Keys) {
    if (-not $active.ContainsKey($id)) { $events += [ordered]@{ event = 'resolved'; id = $id; ts = $rec.ts; finding = $prevActive[$id]; evidence_ref = $ev } }
  }
  return @{ active = @($active.Values); events = $events }
}

function Invoke-OneRun {
  $prev = Get-PrevSnapshot
  $rec  = Invoke-Collect
  $f    = Invoke-Findings $rec $prev
  $rec.findings_active = $f.active
  Append-Jsonl (Join-Path $OBS ("telemetry_" + ([DateTime]$rec.ts).ToUniversalTime().ToString('yyyy-MM-dd') + ".jsonl")) $rec
  Write-AtomicJson (Join-Path $OBS 'current.json') $rec
  foreach ($e in $f.events) {
    $o = [ordered]@{ schema = 'observatory-finding/1' } + $e
    Append-Jsonl (Join-Path $OBS ("findings_" + ([DateTime]$rec.ts).ToUniversalTime().ToString('yyyy-MM-dd') + ".jsonl")) $o
  }
  # observer self-health
  $statusPath = Join-Path $OBS 'observer-status.json'
  $st = [ordered]@{ schema = 'observatory-status/1'; last_run_utc = $rec.ts; collect_ms = $rec.collect_ms; last_errors = $rec.errors; active_findings = $f.active.Count }
  if ($prev) { $st.prev_ts = $prev.ts }
  if (Test-Path $statusPath) {
    try { $old = Get-Content $statusPath -Raw | ConvertFrom-Json; $st.total_runs = [int]$old.total_runs + 1; $st.consecutive_errors = if ($rec.errors.Count -gt 0) { [int]$old.consecutive_errors + 1 } else { 0 } } catch {}
  }
  if (-not $st.total_runs) { $st.total_runs = 1 }
  if ($null -eq $st.consecutive_errors) { $st.consecutive_errors = if ($rec.errors.Count -gt 0) { 1 } else { 0 } }
  Write-AtomicJson $statusPath $st
  # bounded retention: drop our own telemetry/findings files older than N days
  Get-ChildItem $OBS -Filter 'telemetry_*.jsonl' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RETENTION_DAYS) } | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem $OBS -Filter 'findings_*.jsonl'  | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RETENTION_DAYS) } | Remove-Item -Force -ErrorAction SilentlyContinue
  if (-not $Quiet) { Write-Host ("[{0}] {1}ms host={2}%cpu mem={3}MBfree docker={4} pm2={5} findings={6} err={7}" -f $rec.ts,$rec.collect_ms,$rec.host.cpu_pct,$rec.host.mem_avail_mb,$(if($rec.docker.available){'ok'}else{'DOWN'}),$(if($rec.pm2.available){'ok'}else{'DOWN'}),$f.active.Count,$rec.errors.Count) }
  return $rec
}

$r = Invoke-OneRun
if (-not $Once) {
  while ($true) { Start-Sleep -Seconds $IntervalSec; Invoke-OneRun | Out-Null }
}
exit 0
