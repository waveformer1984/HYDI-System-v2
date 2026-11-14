# Needs from Jordan (Frank / phone)

Commands are copy-paste ready. Paste **stdout only** back into chat or commit under `internal/inventory/` if large.

## P0 — Heidi advisory token (Ursula ↔ heidi-agent)

`HEIDI_ADMIN_TOKEN` must live in `.env.local` only (never in browser JS). Ursula proxies
approve/reject/feedback/pending via `/api/heidi-advisory/*` and attaches the Bearer server-side.

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1
# Or generate once without echoing the value:
node -e "require('fs').appendFileSync('.env.local', 'HEIDI_ADMIN_TOKEN=' + require('crypto').randomBytes(32).toString('hex') + '\nHEIDI_ALLOW_EXEC=false\n')"
pm2 restart heidi-agent ursula-local --update-env
pm2 save
```

Set matching CORS on heidi-agent: `HEIDI_ADVISORY_ALLOWED_ORIGINS=http://127.0.0.1:3100` (already in `ecosystem.config.js` for `heidi-agent`).

**Paste back:** confirmation tokens are set (not the values) + `node scripts/hydi-verify.js --offline` PASS table.

## P0 — Unblock mobile + PM2

```powershell
cd C:\Users\Owner\HYDI-System-v2
(Get-Item "$env:USERPROFILE\Desktop\heidi-mobile-token.txt").Length
# If length is ~2× token char count, re-save the Desktop file as UTF-8 before copy.
New-Item -ItemType Directory -Force $env:USERPROFILE\.hydi | Out-Null
Copy-Item "$env:USERPROFILE\Desktop\heidi-mobile-token.txt" "$env:USERPROFILE\.hydi\heidi-mobile-token"
# Shell must NOT set HEIDI_MOBILE_TOKEN (env wins over file):
pm2 restart heidi-mobile-chat --update-env
pm2 save
Remove-Item "$env:USERPROFILE\Desktop\heidi-mobile-token.txt" -ErrorAction SilentlyContinue
```

**Paste back:** log line `HEIDI_MOBILE_TOKEN loaded from file` (not the token) + `pm2 list` row for `heidi-mobile-chat` = online.

## P0 — Ground-truth inventory (Phase 0)

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\inventory.ps1
```

**Paste back:** path to generated `inventory.json` summary section (or attach file).

## P1 — Archive approval (Phase 1)

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\archive-folders.ps1
# Review output; when approved:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\archive-folders.ps1 -Apply
```

**Paste back:** `-Apply` exit code + first/last 30 lines of output.

## P2 — Windows autostart (Phase 2)

```powershell
cd C:\Users\Owner\HYDI-System-v2
pm2 startup
# Run the command pm2 prints (Admin), then:
pm2 save
```

**Paste back:** confirmation that reboot test was done OR "deferred".

## P2 — Port doctor (optional fix)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\port-doctor.ps1
# Only if conflicts listed:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\port-doctor.ps1 -Fix
```

## P5 — Embedding dimension decision

Choose **one**:

```powershell
# (a) 1536-dim local model — example:
ollama pull mxbai-embed-large
```

```sql
-- (b) OR approve migration to 768-dim column (agent will open PR after you reply "768")
```

**Paste back:** `ollama list` line for embedding model OR the word `768` / `1536`.

## P5 — Seed divisions on live Supabase

```powershell
cd C:\Users\Owner\HYDI-System-v2
npx supabase db push   # if migration not applied
node scripts/seed-divisions.js --allow-remote
```

**Paste back:** script summary line (`inserted N`).

## P7 — Phone probes (Termux)

```bash
cd ~/HYDI-System-v2   # or your clone path
bash scripts/phone/run-all-pending.sh
```

**Paste back:** full PASS/FAIL table.

## P10 — Full verify on Frank

```powershell
cd C:\Users\Owner\HYDI-System-v2
node scripts/hydi-verify.js
```

**Paste back:** entire stdout table.

## Job scout go-live (Frank) — run in this order

Run **after** the job-scout PRs (#556–#560) are merged. Each step says what to paste back.

```powershell
cd C:\Users\Owner\HYDI-System-v2

# 1) Pull the merged code
git pull
# PASTE BACK: output of  git log -1 --oneline

# 2) Apply the job_lead notifications migration — LOCAL Supabase only, never --linked/remote
npx supabase migration up
# PASTE BACK: the last ~15 lines of output (should list 20261115000000_notifications_job_lead applied)

# 3) Restart the services that read the new code/config
pm2 restart hydi-schedulers heidi-web-standalone ursula-local --update-env
# PASTE BACK: pm2 list rows for hydi-schedulers, heidi-web-standalone, ursula-local (status online, restart count)

# 4) First real scan (writes .runtime/job-scout/leads.json + status.json)
node scripts/job-scout.js --once
# PASTE BACK: the summary JSON the script prints (sources ok/failed, kept, newLeads)

# 5) Runtime audit
npm run runtime:audit
# PASTE BACK: the audit table
```

Optional afterwards: set `JOB_SCOUT_LLM_DRAFTS=true` in `.env.local` + `pm2 restart hydi-schedulers --update-env` for local-model drafts (falls back to templates on any error). Leave `HEIDI_ALLOW_EXEC=false`.

## P0 — Ursula operator token (after PR #569)

Ursula state-changing APIs need `URSULA_ADMIN_TOKEN` in `.env.local` (server only). Loopback bind is `127.0.0.1:3100` — do not expose `0.0.0.0`.

```powershell
cd C:\Users\Owner\HYDI-System-v2
# run-all-pending.ps1 can mint this without printing it
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1
pm2 restart ursula-local --update-env
pm2 save
```

**Paste back:** `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3100/api/heidi/health` → `200` from loopback; without Bearer on `/api/devices` → `401`.

## P0 — Clean tree for auto-deploy

```powershell
cd C:\Users\Owner\HYDI-System-v2
git checkout clean-main
git pull origin clean-main
git stash push -u -m "pre-deploy tracked-tree cleanup"
git status --porcelain
```

See `docs/DEPLOY_GIT_CLEAN.md`. **Paste back:** empty porcelain + `npm run runtime:audit` first line (`overall`).

## P1 — Job scout from Ursula (after #570)

Needs `HEIDI_ALLOW_EXEC=true` (and mission worker armed) so allowlisted `job_scout_scan` executes.

```powershell
pm2 restart heidi-core hydi-daemon --update-env
```

**Paste back:** Ursula Freelance → Run scan now message + refreshed lead count.

## Batch (Frank)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1
```

## Job scout — division profiles needed

`config/job-scout.json` has profiles for AppForge, Build-A-Mind, ForgeFinder and Galactic Bytes. These divisions have **no profile yet**, so the scout can't rank leads for them:

- **GroundWork**
- **J.STEIN Collection**
- **Colter's Little Smokehouse**
- **Z-Aero Foundation**

For each one, reply with:

1. What kind of work should the scout look for? (e.g. the services/products it sells)
2. Any keywords, sites or buyer types that show up in those posts?
3. A one-line "pitch" — how we describe the work when drafting a reply?
4. Any hard exclusions (work we won't take)?

Don't worry about format — plain sentences are fine; Devin will turn them into config entries. Nothing is invented until you answer.
