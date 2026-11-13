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
# If HEIDI_MOBILE_TOKEN is already in .env.local, propagate to PM2:
pm2 restart heidi-mobile-chat --update-env
pm2 save
```

**Paste back:** last 20 lines of `pm2 logs heidi-mobile-chat --lines 20 --nostream` (redact token values).

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

## Batch (Frank)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1
```
