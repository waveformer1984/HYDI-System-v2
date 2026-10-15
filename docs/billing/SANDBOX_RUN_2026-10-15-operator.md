# Billing sandbox run — operator evidence log

**Status:** NOT_STARTED — fill this file on `C:\Users\Owner\HYDI-System-v2` after completing `docs/billing/SANDBOX_RUN_OPERATOR.md`.

| Field | Value |
|-------|--------|
| Date (UTC) | |
| Git commit | |
| Branch | |
| task_id (workflow) | |
| tenant_id (uuid) | |

---

## Step results

| Step | Status (PASS/FAIL/BLOCKED/NOT_RUN) | Evidence (no secrets) |
|------|-------------------------------------|------------------------|
| Docker | | |
| supabase start | | |
| billing:preflight | | |
| stripe listen | | |
| sandbox setup | | |
| npm run dev | | |
| Browser 4242 checkout | | |
| /billing Active after webhook | | |
| ai/complete → 429 | | |
| Decline card | | |
| Invalid webhook signature | | |
| Duplicate webhook | | |
| Reconcile | | |
| Cancel / refund | | |

---

## DB snapshots (counts / statuses only)

```
(paste output of: node scripts/billing-sandbox-workflow.js snapshot --tenant-id ... )
```

---

## Automated tests

| Command | Exit | Summary |
|---------|------|---------|
| npm run typecheck | | |
| npx jest tests/unit/billing | | |
| npm run test:local | | |
| npm run ci:local -- --no-post | | |

---

## Sign-off

- [ ] §J.5–7 completed with evidence above
- [ ] §L “Real sandbox run” ready to check off in REVENUE_STREAMS_MODULE.md
