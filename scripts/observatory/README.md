# HYDI Hardware & Runtime Observatory

Independent, read-only host/runtime observer. Runs outside Heidi, PM2, Docker,
and the HYDI database so it keeps collecting evidence when any of them are down.

## Artifacts (`.observatory/`, gitignored, local-only)

| File | Purpose |
|---|---|
| `telemetry_YYYY-MM-DD.jsonl` | Append-only samples, UTC-dated, rotated daily |
| `findings_YYYY-MM-DD.jsonl` | Transition events only: `raised` / `resolved` / `severity_changed` |
| `current.json` | Atomic latest snapshot (tmp-write then rename) |
| `observer-status.json` | Collector self-health: runs, errors, collect_ms |

Retention: telemetry/findings files older than 14 days are removed by the
collector itself (only its own files, only inside `.observatory/`).

## Run contract

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\observatory\collect.ps1 -Once
```

- `-Once` produces exactly one sample and exits — this is the Scheduled Task mode.
- Without `-Once` it loops every `-IntervalSec` (default 60).
- Windows PowerShell 5.1 compatible. No HTTP listener. No LLM dependency.
- Read-only against the monitored system: CIM, `docker` CLI, `pm2 jlist`,
  TCP probes, one `GET /api/health` call. Per-subsystem failures are isolated —
  a failed Docker query never discards host metrics.

## Scheduling (Windows Task Scheduler, user-level)

```powershell
schtasks /create /tn HYDI-Observatory /sc minute /mo 1 /f /tr "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File <abs-path-to>\collect.ps1 -Once -Quiet"
```

## No-secrets policy

`pm2_sanitizer.js` reduces `pm2 jlist` to name/pid/status/restarts/uptime/mem/cpu.
Process environment variables are **never** written to telemetry — they can
contain credentials. The sanitizer also fixes a real bug: `pm2_env.env` can
hold duplicate keys differing by case (`username`/`USERNAME`), which crashes
`ConvertFrom-Json` on Windows PowerShell (case-insensitive parser).

## Findings

Findings distinguish `MEASURED | DERIVED | HYPOTHESIS` and carry recommendation
metadata: approval level (`none-needed | operator | owner`), rollback,
success criteria, verification plan. The observer **recommends** — it never
executes optimizations autonomously.
