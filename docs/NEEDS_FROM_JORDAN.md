# Needs from Jordan (Frank / phone)

Commands are copy-paste ready. Paste **stdout only** back into chat or commit under `internal/inventory/` if large.

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
node scripts/seed-divisions.js
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

## Batch (Frank)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\frank\run-all-pending.ps1
```
