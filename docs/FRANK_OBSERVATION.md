# Frank observation

One picture of Frank's health, kept fresh automatically, readable from the
phone and from Heidi, with critical problems pushed to `#alerts`.

## What is observed

| Source | Written by | Covers |
|---|---|---|
| `.observatory/current.json` | `scripts/observatory/collect.ps1` | CPU, RAM, commit charge, disks and their health, top processes, GPU, Docker containers (state, health, restarts), PM2 processes, Ollama, port and `/api/health` probes, active findings |
| `.runtime/storage/status.json` | `frank-storage-guard` | storage level, burn rate, days to CRITICAL, Docker disk size (`docs/STORAGE_PROGRAM.md`) |
| `.heidi-daemon-status.json` | `hydi-daemon` | loop state, last cycle outcome, consecutive failures |

`lib/observation/frank-snapshot.js` combines them into one snapshot with a
level (`OK` / `WARN` / `CRIT`) and a list of issues. Each source carries
its age. A monitor that has never written, or whose sample is older than
3 minutes, is itself a critical issue: "not observed" never reads as
healthy.

## Moving parts

- **`frank-observer`** (PM2, every 60s, read-only): runs `collect.ps1 -Once`
  whenever the last sample is older than 75 seconds, so observation no
  longer depends on a Task Scheduler job being installed. Writes the
  combined snapshot to `.runtime/observation/frank.json`. Posts to
  `#alerts` when a critical issue has held for two passes in a row, once,
  and once more when it clears. Disk alerts are left to the storage guard
  so nothing is announced twice.
- **`GET /api/phone/observe`** (heidi-web): the snapshot as JSON. Bearer
  `HYDI_PHONE_READ_TOKEN`, rate-limited, not on the public-ingress
  allowlist, reads files only.
- **Phone Hydi**: a "Frank health" card on the dashboard (level plus the
  worst issue, cached for a minute) and a chat tool — ask "frank", "cpu",
  "disk", "docker" or "vitals".
- **Heidi on Frank**: `REQUEST @Heidi: frank status` on `#ops` returns the
  same snapshot as text.

## Cleanup

Observation is read-only. The safe, automatic cleanup on Frank is the
storage guard's tiered cache cleanup (`docs/STORAGE_PROGRAM.md`). Anything
else the snapshot points at (an errored PM2 app, an unhealthy container)
goes through Heidi's approval path as before.

## One-time setup on Frank

After this is merged and auto-deployed, from PowerShell in the repo:

```powershell
pm2 start ecosystem.config.js --only frank-observer
pm2 save
node scripts/frank-observer.js --once   # prints the snapshot
```

The phone needs `HYDI_PHONE_READ_TOKEN` (the same token revenue uses);
`hydi-update` already fills it in through pairing.

## Stray processes

PM2 on Windows has repeatedly lost track of processes it started: daemon
copies that kept the daemon lock, and a Next server that held port 3000 for
9 hours while PM2's own copy crash-looped. `lib/observation/strays.js` runs
each observer pass on Frank and raises a CRIT issue (alerted after two
passes) for:

- the process listening on :3000, when it isn't `heidi-web-standalone` or one of its children;
- the process holding `.heidi-daemon.lock`, when it isn't `hydi-daemon`;
- any `ProcessContainerFork` child of the PM2 daemon that PM2 no longer lists.

The alert names the pid and the command to stop it (`Stop-Process -Id <pid>`).
The observer never stops anything itself.
