# Mobile recommended actions — operator vs automated

Runbook for the strategic mobile/evolution checklist. Cloud agents and the
execution fabric can run the **automated** rows; **operator** rows need Frank
or GitHub dashboard access.

## Automated (phone / fabric / cloud agent)

| Action | How |
|--------|-----|
| Host + git diagnostics | Objective `ops.host-health-snapshot` or typed `health.check`, `git.inspect` |
| Billing schema/env diagnostics | Objective `ops.billing-sandbox-verify` or typed `billing.preflight`, `billing.migration_status`, `billing.verify_execution` |
| Full read-only bundle | Objective `ops.mobile-recommended` |
| One-shot CLI report | `node scripts/run-mobile-recommended-actions.js` |
| Fix-list → missions (v2) | Set `HEIDI_FIXLIST_MISSIONS=1` on `frank-observer`; CRIT items with 2+ passes propose Heidi missions (approval still required) |

## Operator-only (cannot complete from cloud VM)

| Action | Where | Evidence to save |
|--------|--------|------------------|
| Clear GitHub billing lock | https://github.com/settings/billing | Green `unit-tests.yml` job with non-zero `runner_id` |
| Rotate leaked 2026-07-15 keys | Supabase + Stripe dashboards | Rotation ticket; no secrets in repo |
| Local Supabase Phase 1 production cutover | Frank: `LOCAL_FIRST_PHASE1_RUNBOOK.md` | Migration log + row counts |
| Billing sandbox §J browser + Stripe listen | `docs/billing/SANDBOX_RUN_OPERATOR.md` | `docs/billing/SANDBOX_RUN_<date>-operator.md` |
| Customer identity (Phase 2) | Choose option in `docs/billing/PHASE2_IDENTITY_OPTIONS.md` | PR after decision |
| Start billing worker on Frank | `pm2 start ecosystem.config.js --only hydi-billing-worker` | `.runtime/billing/worker-status.json` updating |

## PM2

`hydi-billing-worker` is declared in `ecosystem.config.js` (Revenue Streams
retry + reconcile). It writes `.runtime/billing/worker-status.json`; mobile
`GET /api/mobile-status` and `GET /api/phone/observe` surface reconcile alerts
from that file without extra DB round-trips.
