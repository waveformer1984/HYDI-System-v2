# Needs from Jordan (Frank / phone)

Commands are copy-paste ready. Paste **stdout only** back into chat or commit under `internal/inventory/` if large.

Context for Frank host vitals on the phone: [MOBILE_OPERATIONS.md](./MOBILE_OPERATIONS.md) (deploy gates),
[FRANK_OBSERVATION.md](./FRANK_OBSERVATION.md) (`.observatory/current.json`), PRs **#582** + **#583**
(merged on `clean-main`).

## Frank host vitals on `/heidi` — **Owner: Devin on Frank**

**Cursor cloud agents:** do not run these steps (no Frank shell). **Jordan:** paste back only after
Devin completes the ordered list unless a step explicitly names you.

Run **in this order**. Skip deploy/build if storage is **LOW** or **CRITICAL** until C: is back
above the deploy floor (see [STORAGE_PROGRAM.md](./STORAGE_PROGRAM.md)); running `npm run build` or
full Jest on a tight disk has wedged Frank before.

### 1) Pre-flight — storage + access (no reboot)

```powershell
cd C:\Users\Owner\HYDI-System-v2
if (Test-Path .runtime\storage\status.json) {
  Get-Content .runtime\storage\status.json | ConvertFrom-Json | Select-Object level, free_gb, updated_at
} else { Write-Host 'storage status missing — start frank-storage-guard or run node scripts/frank-storage-guard.js --once' }
tailscale status --json | ConvertFrom-Json | Select-Object -ExpandProperty Self | Select-Object Online, KeyExpiry
```

Do **not** reboot Frank for this work unless Jordan has confirmed Tailscale **Unattended** (or another
verified return path). A live desktop session is not proof of post-reboot access.

**Paste back:** `level` + `free_gb` from storage status; Tailscale `Online` + whether `KeyExpiry` is empty or a future date.

### 2) Clean tree + pull merged vitals code

```powershell
cd C:\Users\Owner\HYDI-System-v2
git checkout clean-main
git pull origin clean-main
git status --porcelain
git log -1 --oneline
```

**Paste back:** empty `git status --porcelain` (or list what was stashed) + `git log -1` line containing
`frank-host` or merge of **#583**.

### 3) Observatory evidence fresh (frank-observer)

The phone BFF reads **`.observatory/current.json`** on this machine (`frank-host-health.js`). Stale or
missing observatory must **never** show as healthy on the phone.

```powershell
cd C:\Users\Owner\HYDI-System-v2
pm2 describe frank-observer | Select-String 'status|uptime|restarts'
if (-not (Test-Path .observatory\current.json)) {
  node scripts/frank-observer.js --once
}
node -e "const j=require('./.observatory/current.json'); const age=(Date.now()-Date.parse(j.ts))/1000; console.log(JSON.stringify({schema:j.schema,age_sec:Math.round(age),kong:j.probes?.kong_54321,db:j.probes?.db_tcp_54322}));"
```

**Paste back:** `frank-observer` PM2 status **online** + the one-line JSON (`age_sec` ideally &lt; 120).

### 4) Build + promote **heidi-web** (restart alone does not ship UI/BFF)

`next start` serves the **production** `.next` tree, not the working copy.

```powershell
cd C:\Users\Owner\HYDI-System-v2
npm run build
if (-not (Test-Path .next\BUILD_ID)) { throw 'build incomplete — no BUILD_ID' }
# Let frank-auto-deploy promote on its next pass, OR promote manually per CLAUDE.md if auto-deploy is paused.
pm2 restart heidi-web-standalone --update-env
pm2 save
```

**Paste back:** presence of `.next\BUILD_ID` + first line of `.next\hydi-build.json` if present (gitSha only,
no env). `pm2 list` row for `heidi-web-standalone` = **online**.

### 5) Server-side Frank host snapshot (same logic as phone BFF)

```powershell
cd C:\Users\Owner\HYDI-System-v2
node -e "const {buildFrankHostHealth}=require('./lib/heidi-mobile/frank-host-health'); const h=buildFrankHostHealth({root:process.cwd()}); console.log(JSON.stringify({state:h.state,stale:h.stale,reasons:h.reasons,metrics:{disk_c_free_gb:h.metrics.disk_c_free_gb,mem_free_gb:h.metrics.mem_free_gb,kong:h.metrics.kong,db:h.metrics.db}},null,0));"
```

**Paste back:** full JSON line (no secrets). If `stale: true` or `state: degraded`, say so — that is expected
when disk/RAM/kong/db probes fail; the phone must match it.

### 6) Mobile chat BFF up (pairing path for Jordan)

```powershell
cd C:\Users\Owner\HYDI-System-v2
pm2 describe heidi-mobile-chat | Select-String 'status|HEIDI_MOBILE'
# Token must load from file when env unset — see P0 Unblock mobile below if exit 78.
```

**Paste back:** `heidi-mobile-chat` **online** + log confirmation `HEIDI_MOBILE_TOKEN loaded from file` (not the token).

### 7) Jordan — phone verification (after Devin paste-back)

On a paired phone, open **`/heidi` → Status → Refresh**. Expect a **Frank host** card when `frank_host` is
present; vitals label must show **stale** or **degraded** when evidence is bad (never **healthy** on stale).

**Jordan paste back:** connection banner state (`online` vs `degraded`) + Frank vitals label line, or
“no Frank host card” if BFF returned null.

---

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

## Ursula — approve phones without a shell

Ursula’s **Devices** tab lists pending heidi-mobile registrations. The server route signs
`POST /api/devices` with `HYDI_SERVICE_SECRET` (never sent to the browser). Since PR #569,
`/api/devices` also requires `URSULA_ADMIN_TOKEN` (see the section above) — approving a phone
from the Devices tab sends it as Bearer, so both env vars must be set in `.env.local`.

```powershell
cd C:\Users\Owner\HYDI-System-v2
# HYDI_SERVICE_SECRET and URSULA_ADMIN_TOKEN must be in .env.local
pm2 restart ursula-local heidi-web-standalone --update-env
pm2 save
```

Open Ursula on this PC (`http://127.0.0.1:3100/workspace` → Operator → **Devices**). Approve grants **operator** role.

**Paste back:** “Approved device `<device_id>`” or “no pending devices”.

## Front door watchdog (Tailscale :443 → heidi-web)

`frank-observer` raises **CRIT** when `tailscale serve status` is not `443 → http://127.0.0.1:3000` or `/api/health` fails through that path. Fix is manual only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tailscale\serve-heidi-web.ps1
# Never use Funnel. Re-check:
tailscale serve status
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/health
```

**Paste back:** `tailscale serve status` (first 10 lines) + health HTTP code `200`.

## GitHub Pages `deploy` job (if still red)

See `docs/GITHUB_PAGES_DEPLOY.md`. Enable **Settings → Pages → Source: GitHub Actions** once if `enablement: true` is not allowed by org policy.

**Paste back:** “Pages deploy workflow green” or the configure-pages error line.

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
# Optional state-changing blocks:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1 -JobScout
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1 -UrsulaOps
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
