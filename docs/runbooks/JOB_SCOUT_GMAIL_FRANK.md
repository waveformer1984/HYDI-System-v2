# Job Scout Gmail ingest (Frank)

Account: **waveformer1984@gmail.com**. Scope: **gmail.readonly** only — Hydi never sends mail or touches platforms.

## 1. Google Cloud (free)

Create a project → **APIs & Services** → enable **Gmail API** → **OAuth consent screen** (External, test user: waveformer1984@gmail.com) → **Credentials** → **OAuth client ID** → **Desktop app**.

## 2. Frank env (PM2 / `.env.local`, not committed)

Set on Frank:

- `JOB_SCOUT_GMAIL_CLIENT_ID` — Desktop client ID  
- `JOB_SCOUT_GMAIL_CLIENT_SECRET` — Desktop secret  
- `JOB_SCOUT_TOKEN_PATH` — optional; default `%USERPROFILE%\.hydi\job-scout-gmail-token.json`  
- `JOB_SCOUT_GMAIL=1` — turn ingest on (omit or `0` = public feeds only)

Install once if missing: `npm install googleapis` (from repo root).

## 3. First-run OAuth (Frank, one time)

```powershell
cd C:\Users\Owner\HYDI-System-v2
node -e "const g=require('./lib/job-scout/gmail-ingest');g.authorizeDesktop(process.env).then(r=>console.log(r.url))"
```

Open the URL in a browser (same Google account), copy the code, then:

```powershell
node -e "const g=require('./lib/job-scout/gmail-ingest');g.authorizeDesktop(process.env).then(async r=>{const done=await r.complete('PASTE_CODE_HERE');console.log(done)});"
```

Token file is written to `JOB_SCOUT_TOKEN_PATH` (gitignored). Never paste tokens into chat or commits.

## 4. Manual one-shot scan

```powershell
node scripts/job-scout.js
```

Check `.runtime/job-scout/status.json` → `sources.gmail.summary` (jobs, wins, payments, ignored). New email leads appear in `leads.json` with ids `gmail:…`.

## 5. Mobile chat

Pair phone → open **Chat** → **Job picks** card (digest from shortlisted/top leads). **Apply** copies draft + opens job URL; you **Submit** on the site → **I sent it**.

## 6. Schedule today

Job scout runs inside PM2 app **`hydi-schedulers`**, job name **`heidi-job-scout`**, default **every 3 hours** (`JOB_SCOUT_INTERVAL_MS`, default 10800000). Gmail ingest runs in the **same** `runScout` pass (no new ports).

## 7. Confirm schedulers running

```powershell
pm2 describe hydi-schedulers
pm2 logs hydi-schedulers --lines 30
```

Look for `[job-scout]` lines after each tick.

## 8. Win / payment emails

Hire and “funds available” messages in the same Gmail query are routed to `.runtime/job-scout/workspace/` (projects + platform ledger). Optional CLI: pipe JSON to `node scripts/job-scout-ingest-email.js`.

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `gmail_token_missing` | Complete step 3 |
| `googleapis_package_missing` | `npm install googleapis` |
| `gmail` skipped in status | Set `JOB_SCOUT_GMAIL=1` |
| No new leads | Confirm alert emails from Fiverr/Upwork/Freelancer in last 2 days |

## 10. Rules

No platform submit/automation. No extra Gmail scopes. Alerts on the phone (Jordan) should stay on so real messages exist to ingest.