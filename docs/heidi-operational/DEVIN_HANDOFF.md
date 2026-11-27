# Devin handoff — Heidi operational prep

Branch: `heidi-operational-prep` → PR to `clean-main` (**do not merge** until Jordan reviews).

---

## Phase 0 — Truth (read-only)

**SPP prompt for Devin:**

```text
You are on Frank (Windows), repo C:\Users\Owner\HYDI-System-v2, branch heidi-operational-prep.
Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\heidi\phase0-truth-check.ps1
Paste the full contents of C:\ProtoForge_Ecosystem\logs\phase0-report.md in your reply.
Do not delete or restart any PM2 process yet.
STOP for Jordan's review.
```

**After Jordan approves removing legacy mobile only:**

```text
pm2 delete heidi-mobile-chat
pm2 save
pm2 ls
```

Paste `pm2 ls` output. **STOP for Jordan's review.**

---

## Phase 1 — Heartbeat + boot

```text
cd C:\Users\Owner\HYDI-System-v2
git pull origin heidi-operational-prep
npm test -- tests/unit/heidi-operational-heartbeat.test.js --forceExit
pm2 restart heidi-core --update-env
pm2 save
powershell -NoProfile -File docs\heidi-operational\BOOT.md  # follow pm2 startup section manually
```

Verify:

```powershell
curl http://127.0.0.1:3459/health
```

In Supabase SQL (local):

```sql
SELECT count(*) FROM heidi_state_snapshots WHERE source = 'operational-heartbeat';
```

Paste command outputs. **DONE_TEST:** 48h rows, no gap >20 min. **STOP for Jordan's review.**

---

## Phase 2 — Leads

```text
cd C:\Users\Owner\HYDI-System-v2
# Apply migration (Jordan approves on Frank Supabase only):
# supabase db push  OR  run supabase/migrations/20261126120000_heidi_leads.sql
# Edit config/heidi-leads.json with real public sources (Jordan)
$env:HEIDI_LEADS_ENABLED='true'
pm2 restart heidi-core --update-env
node -e "require('./heidi-core/jobs/lead-sweep').runLeadSweep({ store: require('./lib/store').getStore(), repoRoot: process.cwd() }).then(console.log)"
```

Check `logs/heidi-lead-digest-*.md` and `heidi_events` for `lead_digest`. **DONE_TEST:** 7 daily digests, ≥1 lead worth calling. **STOP for Jordan's review.**

---

## Phase 3–4

Read only: `docs/heidi-operational/PHASE3-4.md`. No implementation in this handoff.

---

## CI evidence (Cursor cloud)

```text
node --check heidi-core/jobs/operational-heartbeat.js
node --check heidi-core/jobs/lead-sweep.js
npx jest tests/unit/heidi-operational-heartbeat.test.js tests/unit/heidi-lead-sweep.test.js tests/migrations/20261126120000_heidi_leads.test.js --forceExit
npm run typecheck
```