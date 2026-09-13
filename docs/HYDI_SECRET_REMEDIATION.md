# HYDI Secret Remediation

## Overview

HYDI's secret remediation capability tracks secrets found in Git history and their remediation status. It extends the existing `SecretScanner` (which scans the working tree) with historical commit scanning and durable remediation tracking.

## Security: No Raw Secrets

The remediation tracker NEVER stores raw secret values. Only safe metadata is persisted:

- Secret type (STRIPE_LIVE_KEY, STRIPE_WEBHOOK_SECRET, JWT, etc.)
- Provider (stripe, supabase, vercel, etc.)
- Safe fingerprint (SHA-256 of value, first 16 chars)
- Redacted preview (e.g., `sk_live_...1234`)
- Affected file path
- Commit SHA (not content)
- Exposure severity (CRITICAL, HIGH, MEDIUM, LOW)
- Rotation status, revocation status, cleanup status
- Verification status
- Owner action required
- Timestamps, evidence references

## Historical Secret Types

| Type | Provider | Severity | Example Pattern |
|------|----------|----------|-----------------|
| STRIPE_LIVE_KEY | stripe | CRITICAL | `sk_live_[a-zA-Z0-9]{20,}` |
| STRIPE_TEST_KEY | stripe | MEDIUM | `sk_test_[a-zA-Z0-9]{20,}` |
| STRIPE_RESTRICTED_KEY | stripe | CRITICAL | `rk_live_[a-zA-Z0-9]{20,}` |
| STRIPE_WEBHOOK_SECRET | stripe | HIGH | `whsec_[a-zA-Z0-9]{20,}` |
| SUPABASE_SERVICE_ROLE_JWT | supabase | HIGH | `eyJ...eyJ...` |
| AWS_ACCESS_KEY | aws | HIGH | `AKIA[A-Z0-9]{16}` |
| PEM_PRIVATE_KEY | generic | CRITICAL | `-----BEGIN ... PRIVATE KEY-----` |

## Remediation Lifecycle

```
DISCOVERED → CONFIRMED_EXPOSED → ROTATION_REQUIRED → ROTATION_PENDING_AUTHORIZATION → ROTATED
                                                                                          ↓
                                                                                REMEDIATION_COMPLETE

Also: REVOCATION_REQUIRED → REVOKED
Also: CLEANED_FROM_CURRENT_TREE (but may still be in history)
Also: STILL_IN_HISTORY (requires history rewrite — human authorized only)
Also: OWNER_ACTION_REQUIRED
Also: ESCALATED
```

## Historical Findings (Current State)

Previous investigation found historical credential exposure in Git history:

| Secret Type | Provider | Affected File | Severity | Status |
|-------------|----------|---------------|----------|--------|
| Stripe restricted key (live) | stripe | `vercel-env-checklist.md` | CRITICAL | Removed from tree, still in history |
| Webhook signing secret | stripe | `test-webhook.js` | HIGH | Removed from tree, still in history |
| Vercel OIDC JWT | vercel | `.env.production` | HIGH | Removed from tree, still in history |
| Keeper break-glass JWT | keeper | `.env.test-jwt` | HIGH | Removed from tree, still in history |
| Supabase service-role JWT | supabase | Multiple files | HIGH | Removed from tree, still in history |

### Current Tree Status

All current working-tree copies have been removed or redacted. The `.env.local` file is gitignored and has no direct history entries.

### Git History Status

Git history still contains the historical material. History rewriting is destructive and requires explicit human authorization.

### Rotation Status

Rotation status was NOT externally verified and remains an operator action. Each credential should be:
1. Rotated via the provider dashboard
2. Old credential revoked
3. Revocation verified

## Required Human Actions

1. **Rotate Stripe restricted key** — via Stripe Dashboard → Developers → API keys
2. **Rotate Stripe webhook secret** — via Stripe Dashboard → Developers → Webhooks
3. **Rotate Supabase service-role key** — via Supabase Dashboard → Settings → API
4. **Rotate Vercel OIDC token** — via Vercel Dashboard → Settings → Tokens
5. **Rotate Keeper break-glass JWT** — via Keeper admin console

After rotation, update the remediation tracker:

```typescript
const tracker = getHistoricalSecretRemediationTracker();
tracker.updateRemediation(findingId, {
  status: 'ROTATED',
  rotationStatus: 'COMPLETE',
  verificationStatus: 'ROTATION_VERIFIED',
}, { mode: 'human_authorized', actor: 'owner', role: 'owner' });
```

## Git History Rewriting

**HYDI does NOT rewrite Git history automatically.** History rewriting is destructive and remains explicitly human-authorized.

If history rewriting is desired, the human operator should:
1. Use `git filter-repo` or BFG Repo-Cleaner
2. Force-push the cleaned history (with team coordination)
3. Update the remediation tracker to `HISTORY_REWRITTEN`

## Continuous Scanning

The remediation tracker can be run continuously to detect new exposures:

```typescript
const tracker = getHistoricalSecretRemediationTracker();
const newFindings = tracker.scanHistory({ maxCommits: 500 });
if (newFindings.length > 0) {
  // Alert operator
}
```

## Integration with Release Gate

Gate G18 (Secret exposure / remediation) checks:
- If critical unresolved findings exist → FAIL
- If findings exist but all remediated → PASS
- If no findings → PASS
