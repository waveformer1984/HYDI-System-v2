# Storage & systems optimization program

Frank (heidi-pc) ran C: down to 0.24 GB on 2026-10-24: four concurrent
pre-push test suites, a Docker disk image that only ever grows, and nothing
watching. This program makes space a measured, guarded, routine thing
instead of an emergency.

It has four parts:

1. **Watch** — `frank-storage-guard` (PM2) measures every 15 minutes.
2. **Clean** — the guard clears only what the system regenerates, in tiers.
3. **Gate** — disk-hungry jobs refuse to start on a nearly full disk.
4. **Routine** — a short monthly checklist for what needs a human.

## Levels

Free space on the repo's volume (C: on Frank). Shared by every part
through `lib/storage/disk.js`.

| Level | Free space | What happens |
|---|---|---|
| OK | ≥ 20 GB | Routine cleanup only |
| WATCH | < 20 GB | Routine cleanup; `#alerts` if CRITICAL is < 3 days away at the 24h burn rate |
| LOW | < 10 GB | Cache cleanup; `#alerts` once; local CI pauses below 8 GB |
| CRITICAL | < 5 GB | Widest cleanup; `#alerts` once; auto-deploy pauses |
| UNKNOWN | unreadable | Treated as LOW, never as healthy |

Override with `HYDI_DISK_WATCH_GB`, `HYDI_DISK_LOW_GB`,
`HYDI_DISK_CRITICAL_GB`. Gate floors: `HYDI_DEPLOY_MIN_FREE_GB` (5),
`LOCAL_CI_MIN_FREE_GB` (8).

## What the guard cleans

Everything below is regenerated on demand or is throwaway temp data. The
guard never touches your files, Docker volumes, images a container uses,
the Recycle Bin, or the Docker disk image itself.

The WATCH tier exists because of 2026-10-27: 8.6 GB of old `%TEMP%` files
took C: to 0.6 GB free while every other tier had nothing left to clear.

| From level | Removes |
|---|---|
| OK | local-ci worktrees a crashed run left in `%TEMP%` (`hydi-ci-<sha>-*`, > 6h old); local-ci logs > 14 days; `git worktree prune` |
| WATCH | Anything at the top of `%TEMP%` whose newest content is 2+ days old (Windows only). Links/junctions are never followed or removed, virtual disks (`*.vhdx`, e.g. WSL's swap) are kept, files in use are skipped, and a folder too large to walk counts as in use |
| LOW | `npm cache clean --force`; `.next/cache` (skipped while a deploy holds its lock); `docker builder prune` (build cache only) |
| CRITICAL | `docker image prune` (untagged, unused images only); `pm2 flush` |

`HYDI_STORAGE_AUTOCLEAN=off` turns cleanup off. Measuring, status and
alerts keep running.

## What it reports

- `.runtime/storage/status.json` — level, free/total GB, 24h trend
  (net of what the guard itself freed), days until CRITICAL, Docker disk
  image size, last pass's actions.
- `.runtime/storage/history.jsonl` — one point per pass, 30 days.
- `#alerts` — once per level change (LOW, CRITICAL, UNKNOWN, TREND) and
  once on recovery. Not repeated every 15 minutes.
- `#ops` — weekly report: level, week-over-week change, burn rate, Docker
  disk size, how much the guard freed.

One pass by hand: `node scripts/frank-storage-guard.js --once`.

## Gates

- **frank-auto-deploy** checks free space after it sees new commits and
  before merging or building. Below the floor it posts once to `#alerts`,
  changes nothing, and resumes on its own once space is back.
- **local-ci** skips a watch pass (posts no statuses, so the commits stay
  queued) below its floor; a one-off run exits with an error.

## One-time setup on Frank

From PowerShell in `C:\Users\Owner\HYDI-System-v2`, once this is merged
and deployed:

```powershell
pm2 start ecosystem.config.js --only frank-storage-guard
pm2 save
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

Then in Windows **Settings → System → Storage**, turn on **Storage Sense**
(temporary files, Recycle Bin after 30 days, Downloads left off).

In **Docker Desktop → Settings → Resources → Advanced**, set the disk
image size limit to a number C: can afford (current image size plus
~10 GB headroom), so Docker can't silently consume the drive.

## When the guard alerts

1. Read the alert: it says the free space, the trend, and what is paused.
2. If one more pass of the guard won't do it, in order of payoff:
   - Close Devin/editors that run test suites; never push several branches
     at once (each pre-push runs the full Jest suite).
   - Windows **Disk Cleanup** → *Clean up system files*.
   - Docker: `docker system df`, then remove images/containers you
     recognise as unused. Never `docker volume prune` — the local Supabase
     data lives in volumes.
   - Compact the Docker disk image (monthly checklist, step 3).
3. Deploys and local CI resume by themselves once space is above their
   floors; a recovery message posts to `#alerts`.

## Monthly checklist (about 15 minutes)

1. Read the last weekly report in `#ops`. Note the Docker disk size.
2. `npm run runtime:audit` — nothing STALE/UNDECLARED left lying around.
3. Compact the Docker disk image. Deleting things inside Docker frees
   space in the image but not on C:; compacting returns it.
   1. Quit Docker Desktop. In PowerShell: `wsl --shutdown`.
   2. Admin PowerShell: `diskpart`, then:
      ```
      select vdisk file="%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx"
      attach vdisk readonly
      compact vdisk
      detach vdisk
      exit
      ```
      (Use the full path; diskpart does not expand `%LOCALAPPDATA%`.)
   3. Start Docker Desktop, then `npx supabase start` if it isn't up, and
      check `/api/health`.
4. Check `%USERPROFILE%\.wslconfig` still has `memory=6GB` or more.

## Other devices

The phone (Termux) is at 99% storage too. Device-wide observation —
every device reporting disk, memory, battery and service health to Frank,
shown in one view — is the next phase and reuses the same levels and
status-file contract.
