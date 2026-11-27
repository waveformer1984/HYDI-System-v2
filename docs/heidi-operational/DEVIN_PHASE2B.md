# Devin runbook — Lead scoring v2 (Phase 2b)

Branch: `heidi-leads-scoring-v2` → base `heidi-operational-prep` (deploy/`2026-11-25` not on GitHub). **Do not merge** until Jordan reviews. **Do not** set `HEIDI_LEADS_ENABLED=true` without approval.

## Steps (≤8)

1. `cd C:\Users\Owner\HYDI-System-v2` — `git fetch origin` — checkout `heidi-leads-scoring-v2`.
2. Run unit tests: `npx jest tests/unit/heidi-lead-sweep.test.js tests/migrations/20261126120000_heidi_leads.test.js --forceExit`.
3. Dry-run rescore: `node scripts/heidi/rescore-leads.js --dry-run` — confirm rules scores on CKAN fixtures + single LLM call for `sa-bid`.
4. **Jordan only:** apply `supabase/migrations/20261127193000_heidi_leads_scoring_v2.sql` on local Supabase (`supabase db push` or SQL editor).
5. Confirm `HEIDI_LEADS_ENABLED` is **unset/false**; confirm `HEIDI_MODEL_FLOOR` or `LOCAL_MODEL_NAME` points at an installed Ollama model (no hardcoded qwen in code).
6. Optional manual sweep (Jordan enables flag): `$env:HEIDI_LEADS_ENABLED='true'; pm2 restart heidi-core --update-env` then `node -e "require('./heidi-core/jobs/lead-sweep').runLeadSweep({ store: require('./lib/store').getStore(), repoRoot: process.cwd() }).then(console.log)"`.
7. Verify `logs/heidi-lead-digest-YYYY-MM-DD.md` contains **Top builders** and scored permit rows; confirm unscored rows stay `NULL` in `heidi_leads.score` (never 0).
8. Paste test output + digest header + `SELECT count(*), scored_by FROM heidi_leads GROUP BY scored_by` — **STOP for Jordan**.

## SPP prompt (paste to Devin)

```text
You are on Frank. Repo C:\Users\Owner\HYDI-System-v2, branch heidi-leads-scoring-v2.
HEIDI_LEADS_ENABLED must stay false unless Jordan explicitly toggles it in step 6.
Follow docs in the Context store file docs/heidi-operational/DEVIN_PHASE2B.md steps 1–8.
Run the jest command in step 2 and paste full output.
Run step 3 dry-run and paste the JSON summary only (truncate leads array if huge).
Do not apply migrations or restart PM2 unless Jordan already approved steps 4–6.
Do not merge any PR. STOP after step 8 with evidence.
```

---

## Lead Forge CRM (feat/lead-forge-ui-crm)

**Do not merge without Jordan.** No auto email send. `HEIDI_LEADS_ENABLED` stays off (separate Heidi construction-lead sweep).

### Steps (≤8)

1. `git fetch origin` — checkout `feat/lead-forge-ui-crm`.
2. Tests: `npx jest tests/unit/lead-forge.test.js tests/unit/lead-forge-api.test.js tests/migrations/20261127203000_lf_packs_crm.test.js` — paste output.
3. `npm run typecheck` — must pass.
4. **Jordan only:** apply `supabase/migrations/20261127203000_lf_packs_crm.sql` on local Supabase. DOWN block at file bottom (drop `lf_activities`, `lf_leads`, `lf_packs`).
5. First live pack (review-only, needs board token optional):  
   `node lead-forge/build.js --niche agency-buyers --city "San Antonio, TX" --radius 25 --count 50`  
   Artifacts: `lead-forge/packs/<id>/` (gitignored). Import: `node -e "require('./lib/importPack').importPack('<id>',{pool:require('./lib/lead-forge/db').getPool()}).then(console.log)"`.
6. UI: `/lead-forge` — set `localStorage.HYDI_SERVICE_TOKEN` or device auth; generate pack via API; confirm job polling. Drafts: **copy only**.
7. Confirm `lead-forge/suppression.csv` updates on suppress API (no outreach sent).
8. Paste jest + migration apply status — **STOP for Jordan**.

### SPP prompt (Lead Forge)

```text
Repo HYDI-System-v2, branch feat/lead-forge-ui-crm. Follow Lead Forge section in docs/heidi-operational/DEVIN_PHASE2B.md.
Do not merge. Do not enable HEIDI_LEADS_ENABLED. Do not send email.
Run step 2 tests and paste full output. Step 5 only if Jordan approved live pack on Frank.
```