# Adaptive Operator Staged Rollout Plan

## Context

`ADAPTIVE_OPERATOR_ENABLED` defaults to `false` in production. This
document defines how it gets turned on incrementally — not all at once.

## Deployment Target

**Local-first, PM2-managed Windows host.** Not Vercel serverless.
Confirmed via `CLAUDE.md` ("Vercel deployment — not used") and
`DEPLOYMENT.md`. The filesystem is persistent across restarts, but
Supabase is the durability layer for journal/task-memory events (the
`adaptive_operator_events` table) because fresh clones or disk crashes
would lose local-disk journals.

## Stage 0 — Pre-rollout (current state)

- Flag: `ADAPTIVE_OPERATOR_ENABLED=false` everywhere
- Route: `POST /api/goals` exists, auth-gated, rate-limited, but
  delegates to the legacy LLM-decompose path
- Persistence: local disk only (`.hydi-operational/`), Supabase table
  exists but not wired
- Goal templates: infra + revenue (3 new), but only exercised in
  qualification scripts

**Exit criteria for Stage 1:**
- Run `scripts/e2e-adaptive-operator-integration.ts` against the real
  local stack (not just a temp dir) with Supabase env vars configured
- Confirm `adaptive_operator_events` table receives events
- Confirm events survive a `pm2 restart hydi-boot`

## Stage 1 — Internal-only, infra goals only

**Flag:** `ADAPTIVE_OPERATOR_ENABLED=true` + `ADAPTIVE_OPERATOR_GOAL_ALLOWLIST=infra`

**Who:** Only the operator (J) via the existing service token
(`x-hydi-service-token`). No device tokens, no external callers.

**What goals:** Only infra-health goals (`CODE_HEALTHY`,
`SERVICES_RUNNING`, `ENDPOINT_VERIFIED`, `CREDENTIALS_READY`).
Revenue-engine goals are blocked by the allowlist.

**How to implement the allowlist:** Add an env var
`ADAPTIVE_OPERATOR_GOAL_ALLOWLIST=infra,revenue,connect` (comma-separated
goal categories). When set, the integration module checks the goal
statement against the allowed categories before delegating to
AdaptiveOperator. Goals outside the allowlist fall back to the legacy
path. When unset, all categories are allowed (Stage 3+).

**Rollback trigger:** Any of:
- Escalation rate > 50% (more than half of goals escalate, not complete)
- Any unintended side effect (file modified, process killed, email sent)
- Any `auth_audit_log` entry showing unauthorized goal submission

**Where escalations surface:** The structured-logger writes to
`logs/pm2-hydi-boot.out.log` (PM2-managed). The operator should:
1. Check `logs/pm2-hydi-boot.out.log` for `[WARN] AdaptiveOperator` entries
2. Query `adaptive_operator_events` for `event_type='escalation'`
3. Set up a PM2 log alert (or `pm2 logs hydi-boot --lines 100 | grep
   AdaptiveOperator`) for real-time monitoring

**Duration:** 1 week of daily infra-health goals.

## Stage 2 — Internal-only, revenue read-only goals

**Flag:** `ADAPTIVE_OPERATOR_ENABLED=true` + `ADAPTIVE_OPERATOR_GOAL_ALLOWLIST=infra,revenue,connect`

**Who:** Same as Stage 1 — operator only.

**What goals:** Infra + revenue-engine read-only goals
(`REVENUE_LEDGER_VERIFIED`, `PAYOUTS_RECONCILED`,
`CONNECT_ACCOUNT_VERIFIED`). These generate HTTP GET intents only — no
Stripe mutations. Financial actions (R3+) are blocked by
AuthorityManager and escalated to human.

**Rollback trigger:** Any of:
- Any Stripe API call that is not a GET (read-only violation)
- Any `adaptive_operator_events` entry with
  `event_type='intervention'` and `interventionType='authorization'`
- Escalation rate > 30%
- Any discrepancy between AdaptiveOperator's revenue observations and
  the actual `revenue_ledger` table

**Where escalations surface:** Same as Stage 1, plus:
- Query `adaptive_operator_events` for `event_type='intervention'`
- Check `auth_audit_log` for `permission_denied` entries from the goals
  route

**Duration:** 2 weeks of daily revenue-reconciliation goals.

## Stage 3 — Operator + device tokens, all goal types

**Flag:** `ADAPTIVE_OPERATOR_ENABLED=true` (no allowlist)

**Who:** Operator (owner role) + operator-role device tokens. Not
viewer, not agent role.

**What goals:** All goal types including revenue-engine goals. Financial
mutations still require human authorization (R3+ is blocked by
AuthorityManager).

**Rollback trigger:** Any of:
- Any unauthorized goal submission (check `auth_audit_log`)
- Any financial action executed without explicit human approval
- Escalation rate > 20%
- Any `adaptive_operator_events` entry showing a `decision` event with
  `action='execute'` on a financial capability

**Where escalations surface:** Same as Stage 1-2, plus:
- The existing `pages/agent-manager.tsx` UI should show
  AdaptiveOperator escalations (via `work_sessions` table status)
- The mobile-ops dashboard (`api/mobile-status.js`) should show
  pending-approval work sessions

**Duration:** Indefinite — this is the steady state.

## Rollback Procedure

1. Set `ADAPTIVE_OPERATOR_ENABLED=false` in `.env.local` (or PM2 env)
2. `pm2 restart hydi-boot`
3. All goals now use the legacy LLM-decompose path
4. No data migration needed — `adaptive_operator_events` and
   `work_sessions` tables remain queryable for audit
5. In-flight AdaptiveOperator goals will complete on the next
   `pm2 restart` (they're in-process, not persisted as running state)

## Monitoring Checklist (per stage)

| Check | How | Frequency |
|-------|-----|-----------|
| Escalation rate | `SELECT event_type, count(*) FROM adaptive_operator_events WHERE created_at > now() - interval '1 day' GROUP BY 1` | Daily |
| Auth failures | `SELECT * FROM auth_audit_log WHERE event_type IN ('auth_failure','permission_denied') AND created_at > now() - interval '1 day'` | Daily |
| Unintended side effects | `SELECT * FROM adaptive_operator_events WHERE event_type='action' AND payload->>'capability' LIKE '%destructive%'` | Daily |
| Replan frequency | `SELECT count(*) FROM adaptive_operator_events WHERE event_type='replan' AND created_at > now() - interval '1 day'` | Daily |
| Goal completion rate | `SELECT status, count(*) FROM adaptive_operator_events WHERE event_type='completion' AND created_at > now() - interval '7 days' GROUP BY 1` | Weekly |

## Escalation Channel Readiness

The structured-logger writes to PM2-managed log files. For real-time
alerting, the operator should:

1. **PM2 log alerts:** Configure PM2's `pm2 monit` or a log-watching
   tool to alert on `[WARN] AdaptiveOperator` entries
2. **Supabase query:** Set up a Supabase Edge Function or cron job that
   queries `adaptive_operator_events` for `event_type='escalation'` and
   sends a notification (email/Slack) when new escalations appear
3. **Dashboard:** The `pages/index.tsx` dashboard already shows
   `work_sessions` — AdaptiveOperator sessions appear there with
   status `failed` or `needs_approval` when escalated

**Current gap:** No automated Slack/email notification is wired for
AdaptiveOperator escalations. This is a Stage 1 exit criterion — the
operator must manually check logs until automated alerting is
configured.
