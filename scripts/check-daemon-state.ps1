$proc = Get-Process -Id 12632 -ErrorAction SilentlyContinue
if ($proc) {
    $mem = [math]::Round($proc.WorkingSet64 / 1MB, 2)
    Write-Output "Memory RSS: $mem MB"
} else {
    Write-Output "Process 12632 not found"
}
if (Test-Path .heidi-daemon-audit.jsonl) {
    $size = (Get-Item .heidi-daemon-audit.jsonl).Length
    $lines = (Get-Content .heidi-daemon-audit.jsonl | Measure-Object -Line).Lines
    Write-Output "Audit file size: $size bytes"
    Write-Output "Audit file lines: $lines"
} else {
    Write-Output "Audit file: not yet created"
}
if (Test-Path .heidi-daemon.lock) {
    Write-Output "Lock file: present"
} else {
    Write-Output "Lock file: missing"
}
Write-Output "Timestamp: $(Get-Date -Format 'o')"
