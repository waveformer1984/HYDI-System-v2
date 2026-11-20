# Frank operator card (phone-readable)

Short commands for Frank (`C:\Users\Owner\HYDI-System-v2`) while RAM is tight. **One PR merge at a time** — wait for `frank-auto-deploy` to finish (health green) before the next merge; each merge triggers a Next build.

---

## Unfreeze Claude / Devin (screen control stuck)

Symptom: Devin or Claude UI frozen since ~11:35; cloud agents cannot drive the desktop.

1. On Frank: **Task Manager** → end **Devin** and **Claude** (both).
2. Reopen **Claude** locally.
3. In chat, tell Claude: **`go`**

Until this is done, skip Devin Step 1 below.

---

## Devin Step 1 — memory evidence (read-only)

Paste to Devin / Claude on Frank (no writes, no pm2 stop, no merges):

```
SPP read-only Step 1 — Frank memory / duplicate PM2 evidence.

Report in tables (no secrets):
1) RAM: physical total/available, commit charge, top 15 processes by working set.
2) Docker Desktop + WSL: running?, vmmem RSS.
3) Ollama + Next/heidi-web RSS.
4) Windows Application log Event 2004 (last 24h) if any.
5) pm2 jlist: every app name, status, restarts, pm_uptime — flag hydi-local-ci, proto-yi, the seven scheduler duplicate names if still present (hydi-watchdog, hydi-model-prep-executor, hydi-daily-loop, hydi-protoforge-scout, hydi-stuck-job-scheduler, hydi-revenue-reconciliation, hydi-failed-webhook-retry), and hydi-schedulers.
6) Compare hydi-failed-webhook-retry (if still in PM2) vs hydi-schedulers: same script path on disk?
7) Confirm frank-auto-deploy does NOT require hydi-local-ci online to pass health (read scripts/frank-auto-deploy.js restart filter only).
8) proto-yi: is it online? why? (dump.pm2 vs ecosystem)
9) EXTRA: Under C:\Users\Owner, list every folder whose name matches hydi-* or HYDI-* (any depth). Sort by total folder size, largest first. Read-only — do not delete or move anything.
```

Hold **[HOLD for Frank evidence] memory PR1** until this report exists.

---

## Block local Supabase ports (free RAM; admin PowerShell)

Only when you accept losing local Postgres until Docker/Supabase is started again:

```powershell
New-NetFirewallRule -DisplayName "HYDI block Supabase local 54321-54329" `
  -Direction Inbound -Action Block -Protocol TCP `
  -LocalPort 54321-54329
```

Remove later:

```powershell
Remove-NetFirewallRule -DisplayName "HYDI block Supabase local 54321-54329"
```

---

## After memory PR1 merges — Frank PM2 cleanup (manual)

Cloud agent does **not** run this. From repo root:

```powershell
cd C:\Users\Owner\HYDI-System-v2
pm2 stop hydi-watchdog hydi-model-prep-executor hydi-daily-loop hydi-protoforge-scout hydi-stuck-job-scheduler hydi-revenue-reconciliation hydi-failed-webhook-retry hydi-local-ci proto-yi
pm2 delete hydi-watchdog hydi-model-prep-executor hydi-daily-loop hydi-protoforge-scout hydi-stuck-job-scheduler hydi-revenue-reconciliation hydi-failed-webhook-retry hydi-local-ci proto-yi
pm2 save
```

Ticks for the seven removed apps should run only under **`hydi-schedulers`**. Start local CI or proto-yi when needed:

```powershell
pm2 start ecosystem.config.js --only hydi-local-ci
pm2 start ecosystem.config.js --only proto-yi
```

Fleet bring-up uses `node scripts/pm2-start-declared.js` (skips `autostart: false`).

---

## MakeReady Bot — post-merge (manual SQL + config)

Merges do **not** apply migrations. See `docs/runbooks/MAKEREADY_BOT.md`.

```powershell
cd C:\Users\Owner\HYDI-System-v2
$env:PGHOST = "127.0.0.1"; $env:PGPORT = "54322"
$env:PGUSER = "postgres"; $env:PGPASSWORD = "postgres"; $env:PGDATABASE = "postgres"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120120000_makeready_bot.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120180000_makeready_leads.sql
```

Set SaaS prices (cents) in `config/makeready/platform-offer.json`:

```json
"setup_cents": 99000,
"monthly_cents": 14900
```

Onboard customer #2..N:

```powershell
node scripts/makeready-onboard.js your-company-slug
```

Offer page: `http://127.0.0.1:3000/makeready-bot`

---

## Merge discipline (Frank memory-starved)

1. Merge **one** PR.
2. Watch `frank-auto-deploy` / `pm2 logs frank-auto-deploy` until deploy health passes (or rollback).
3. Run any **manual** steps (PM2 delete list, psql migrations, price JSON).
4. Only then merge the next PR.

Do not stack merges while free RAM is below deploy thresholds (`docs/STORAGE_PROGRAM.md`, `HYDI_DEPLOY_MIN_FREE_RAM_GB`).