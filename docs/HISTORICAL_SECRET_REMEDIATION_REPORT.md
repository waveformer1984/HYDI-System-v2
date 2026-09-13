# Historical Secret Exposure Remediation Report

**Date:** 2026-08-25
**Auditor:** Devin (automated)
**Repository:** HYDI-System-v2
**Branch:** `feat/governed-autonomy`

---

## Executive Summary

A prior security incident (remediated in commit `67781b7` on 2026-07-15) exposed real Stripe and Vercel credentials in tracked files. The credentials were removed from the working tree in that commit, but remain in git history. The `.env.backup` file that triggered this audit contained only placeholder values (`sk_live_...`, `whsec_...`), not real keys — the real exposure was in `vercel-env-checklist.md` and `test-webhook.js`.

---

## Affected Credentials

### 1. Stripe Restricted LIVE Key

| Field | Value |
|-------|-------|
| Secret type | Stripe restricted API key (live mode) |
| Prefix | `rk_live_51R8ZCrITaXOH...` |
| File | `vercel-env-checklist.md` |
| Affected commits | `a76eee0`, `db35319`, `cc2f2b3` (added); `67781b7` (removed from working tree) |
| Current working tree | CLEAN — file moved to `archive/stale-april-2026-deployment-reports/vercel-env-checklist.md` with secret removed |
| Git history | **SECRET REMAINS IN HISTORY** (4 commits) |
| Rotation status | **UNKNOWN — requires Stripe Dashboard verification** |
| Stripe CLI comparison | CLI's cached live key has a DIFFERENT prefix — may indicate prior rotation, but cannot confirm without Dashboard access |

### 2. Stripe Webhook Signing Secret

| Field | Value |
|-------|-------|
| Secret type | Stripe webhook endpoint signing secret |
| Prefix | `whsec_VnrIjBX7F1bkBZp...` |
| File | `test-webhook.js` |
| Affected commits | `aa5b514`, `aa0d820`, `cc2f2b3` (added); `67781b7` (removed from working tree) |
| Current working tree | CLEAN — file renamed to `test-webhook-endpoint.js` with secret removed |
| Git history | **SECRET REMAINS IN HISTORY** (4 commits) |
| Rotation status | **UNKNOWN — requires Stripe Dashboard verification** |

### 3. Vercel OIDC JWT

| Field | Value |
|-------|-------|
| Secret type | Vercel OIDC token (RS256 JWT, 1163 chars) |
| File | `.env.production` |
| Affected commits | `cc2f2b3` (added); `4673628` (untracked) |
| Current working tree | CLEAN — file not tracked |
| Git history | **SECRET REMAINS IN HISTORY** |
| Rotation status | **UNKNOWN — requires Vercel Dashboard verification** |

### 4. Keeper Break-Glass JWT

| Field | Value |
|-------|-------|
| Secret type | Keeper break-glass JWT (HS256, 237 chars) |
| File | `.env.test-jwt` |
| Affected commits | `cc2f2b3` (added); `4673628` (untracked) |
| Current working tree | CLEAN — file not tracked |
| Git history | **SECRET REMAINS IN HISTORY** |
| Rotation status | **UNKNOWN — requires Keeper admin verification** |

### 5. Supabase Service-Role JWT

| Field | Value |
|-------|-------|
| Secret type | Supabase service-role JWT (full RLS bypass) |
| Files | 21 tracked files (per commit `67781b7` message) |
| Affected commits | Multiple (initial commit through `67781b7`) |
| Current working tree | CLEAN — verified by `no-hardcoded-secrets.test.js` (2/2 pass) |
| Git history | **SECRET REMAINS IN HISTORY** |
| Rotation status | **UNKNOWN — requires Supabase Dashboard verification** |

---

## `.env.backup` Status (Original Trigger)

The `.env.backup` file that triggered this audit contained only **placeholder values**, not real secrets:

| Key | Value | Status |
|-----|-------|--------|
| `STRIPE_SECRET_KEY` | `sk_live_...` (11 chars) | PLACEHOLDER — not a real key |
| `STRIPE_WEBHOOK_SECRET_01` | `whsec_...` (9 chars) | PLACEHOLDER — not a real secret |
| `SUPABASE_SERVICE_ROLE_KEY` | `your-service-role-key` | PLACEHOLDER |

The file was committed in `db35319` and `cc2f2b3`, untracked in `4673628` and `8cfe6cc`. While the values are placeholders, the file itself should not have been tracked.

---

## Remediation Actions Taken

### Already completed (prior commit `67781b7`, 2026-07-15)

- Real Stripe restricted key removed from `vercel-env-checklist.md`
- Real Stripe webhook secret removed from `test-webhook.js`
- Supabase service-role JWT removed from 21 tracked files
- Migration `20260715210000` created to move cron invoker credentials to Supabase Vault
- `.env.backup`, `.env.production`, `.env.test-jwt` untracked from git

### Completed in this session (commit `7caefe1`, 2026-08-25)

- Added `sk_test_` and `rk_test_` to structured-logger redaction patterns (were missing)
- Added `sk_test_` (long) pattern to `no-hardcoded-secrets.test.js` scanner
- Installed pre-commit hook scanning staged changes for all secret patterns
- Verified `.env.local` is git-ignored and never committed
- Verified `.env.local` file permissions (SYSTEM/Administrators/Owner only)
- Verified boot scripts log key NAMES only, never values
- Verified `auth_audit_log` never logs token values
- Verified `ecosystem.config.js` contains no secrets

### Remaining actions (OPERATOR RESPONSIBILITY)

**SECURITY BLOCKER: historical Stripe LIVE secret requires immediate rotation**

The following credentials were exposed in git history and must be rotated in their respective dashboards. Git history does not forget on its own — removing a file from the working tree does not remove it from history.

1. **Stripe Dashboard** → Rotate the `rk_live_51R8ZCrITaXOH...` restricted key
2. **Stripe Dashboard** → Rotate/revoke the `whsec_VnrIjBX7F1bkBZp...` webhook endpoint secret
3. **Vercel Dashboard** → Revoke the OIDC token from `.env.production`
4. **Keeper Admin** → Revoke the break-glass JWT from `.env.test-jwt`
5. **Supabase Dashboard** → Rotate the service-role JWT (if not already done)

**Optional (requires explicit authorization):** Consider using `git filter-repo` or BFG Repo-Cleaner to purge the secrets from git history. This is a destructive operation that rewrites history and requires force-pushing. Do NOT attempt without explicit authorization and coordination with all collaborators.

---

## Current Working Tree Status

| Check | Result |
|-------|--------|
| `no-hardcoded-secrets.test.js` | 2/2 PASS |
| `.env.local` git-ignored | YES |
| `.env.local` ever committed | NO |
| `.env.backup` tracked | NO |
| `.env.production` tracked | NO |
| `.env.test-jwt` tracked | NO |
| Pre-commit secret scan hook | INSTALLED |
| Structured-logger redaction | Covers `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`, `whsec_`, JWT, AWS, PEM |
| Boot scripts log env values | NO (key names only) |

---

## Repository-History Status

The secrets remain in git history in the following commits:

| Commit | File | Secret |
|--------|------|--------|
| `a76eee0` | `vercel-env-checklist.md` | `rk_live_51R8ZCrITaXOH...` |
| `db35319` | `vercel-env-checklist.md` | `rk_live_51R8ZCrITaXOH...` |
| `cc2f2b3` | `vercel-env-checklist.md` | `rk_live_51R8ZCrITaXOH...` |
| `aa5b514` | `test-webhook.js` | `whsec_VnrIjBX7F1bkBZp...` |
| `aa0d820` | `test-webhook.js` | `whsec_VnrIjBX7F1bkBZp...` |
| `cc2f2b3` | `test-webhook.js` | `whsec_VnrIjBX7F1bkBZp...` |
| `cc2f2b3` | `.env.production` | Vercel OIDC JWT |
| `cc2f2b3` | `.env.test-jwt` | Keeper break-glass JWT |
| Multiple | 21 files | Supabase service-role JWT |

History rewriting has NOT been performed. This is a deliberate decision — history rewriting is destructive and requires explicit authorization. The secrets must be rotated regardless of whether history is rewritten, because anyone who already cloned the repo has the history.

---

## Conclusion

The real credential exposure was identified and remediated in the working tree by commit `67781b7` (2026-07-15). This session (commit `7caefe1`) added additional preventive controls (redaction patterns, pre-commit hook, secret scan expansion).

**The credentials in git history are the remaining risk.** They must be rotated in their respective dashboards. History rewriting is optional but recommended if the repository is public or has external collaborators.
