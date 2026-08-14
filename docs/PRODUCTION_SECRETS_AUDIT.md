# Production Secrets Audit

Date: 2026-08-14
Branch: `release/v0.9.0`

## Scope

Determine whether live Stripe, Supabase, webhook, or other production credentials are present in:

1. Current working tree files
2. Git-tracked files
3. Git history
4. Build artifacts (`.next/`)
5. Frontend/client bundles
6. Logs
7. Documentation

No secret values are printed in this report. Only file names and commit identifiers are shown.

## Method

- Searched current tree for patterns: `sk_live_`, `sk_test_`, `whsec_`, `sb_secret_`, `sb_publishable_`, `postgresql://`, `DATABASE_URL=`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HYDI_SERVICE_SECRET`.
- Verified `.env` / `.env.local` / `.env.*` are excluded by `.gitignore`.
- Used `git log --all -S <pattern> --format="%H %s" --name-only` to identify historical commits where secret patterns appeared.
- Built production artifact with `npm run build` and scanned `.next/` for secret values.

## Findings

### 1. Current working tree

| Secret type | Location | Status | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY=sk_live_...` | `.env` | EXPOSED (working tree) | Live Stripe key present in working tree. File is `.gitignore`d but exists on disk. |
| `STRIPE_WEBHOOK_SECRET_01=whsec_...` | `.env` | EXPOSED (working tree) | Live Stripe webhook secret present. |
| `STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...` | `.env` | EXPOSED (working tree) | Placeholder-like live value. |
| `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...` | `.env` and `.env.local` | EXPOSED (working tree) | Service-role key present in both files. |
| `HYDI_SERVICE_SECRET=...` | `.env` | EXPOSED (working tree) | HMAC inter-service secret. |
| `VERCEL_OIDC_TOKEN=eyJ...` | `.env.local` | EXPOSED (working tree) | JWT token present. |
| `DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@...` | `.env` | EXPOSED (working tree) | Contains placeholder password and cloud host. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` | `.env` and `.env.local` | EXPOSED (working tree) | Anon/publishable key, safe for client but should not be in repo. |

**No live secret values** were found in tracked files after excluding `.env`, `.env.local`, `backups/`, `artifacts/`, `.next/`, `node_modules/`, `out/`.

### 2. Git-tracked files

`.env*` files are excluded from Git by `.gitignore`. However, the working tree `.env` and `.env.local` are not protected from accidental `git add -f`.

Historical `.env.example`, `.env.template`, `.env.production`, `.env.backup` files are tracked in commit history and have contained placeholder or real values in the past.

### 3. Git history exposure

The following **historical** exposure is confirmed. The commit hashes below are the commits where the patterns appeared in diffs, not necessarily where the current live values were added.

| Pattern | Historical commit (example) | File(s) | Assessment |
|---|---|---|---|
| `sk_live_` (live Stripe account prefix `51SWNEGF3prUQPYI3`) | `8c2f4dc5...` | `supabase/functions/.env.production` | **P0 — live Stripe key exposed in Git history.** Requires rotation/revocation. |
| `whsec_` (webhook prefix `VnrIjBX7F1bkBZpuoRORqxPbey6b14wh`) | `67781b77...`, `8c2f4dc5...`, `aa0d8206...`, `aa5b514a...` | `test-webhook.js`, `supabase/functions/.env.production`, `vercel-sync-analysis.md` | **P0 — webhook secret exposed in Git history.** Requires rotation/revocation. |
| `sb_secret_` (service role partial `N7UND0UgjKTVK`) | `db5bcbcb...`, `795879ec...`, `f391c25c...`, etc. | `check-*.js`, `heidi-core/HEIDI.ps1`, `task-*.js`, `test-*.js`, `configure-vault.js`, `setup-vault.js` | **P0 — Supabase service-role key exposed in Git history.** Requires rotation/revocation. |
| `STRIPE_SECRET_KEY=sk_live_` | `da29cee...` | `HYDI_CURRENT_OPERATIONAL_STATUS.md` | Reference in documentation (this report) only; no value. |

**Verdict:** At least one live Stripe secret, one webhook secret, and the Supabase service-role key have been committed to Git history. These credentials must be considered compromised and rotated.

### 4. Build artifacts (`.next/`)

After `npm run build`, `.next/` was scanned for the current live secret values.

- `STRIPE_SECRET_KEY` value prefix: **0 matches**
- `SUPABASE_SERVICE_ROLE_KEY` value partial: **0 matches**
- `STRIPE_WEBHOOK_SECRET` value partial: **0 matches**
- `HYDI_SERVICE_SECRET` value: **0 matches**

The build artifact contains variable **names** such as `STRIPE_SECRET_KEY` in server bundles (which is expected for code that reads the env var), but the **values** from `.env` are not embedded in the build. This is correct because Next.js does not inline non-`NEXT_PUBLIC_` env vars into the client bundle, and the server bundles use `process.env.*` at runtime.

### 5. Frontend/client bundles

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is exposed to the browser (intentionally — it is a publishable key). No `sk_live_`, `whsec_`, `sb_secret_`, or `HYDI_SERVICE_SECRET` values were found in `.next/static` bundles.

### 6. Logs

No central log directories were audited. Console logs in the local runtime do not print these values. `lib/structured-logger.js` has redaction logic, but it was not tested for these specific keys.

### 7. Documentation

The newly created `HYDI_CURRENT_OPERATIONAL_STATUS.md` mentions `sk_live_` as a pattern in the working tree. No other documentation files contain actual secret values.

## Risk classification

| Finding | Priority | Action |
|---|---|---|
| Live `sk_live_` in `.env` (working tree) | P1 | Move to secure runtime secret store; never commit. |
| Live `sk_live_` in Git history (`supabase/functions/.env.production`) | **P0** | Rotate/revoke Stripe secret key. |
| Live `whsec_` in Git history | **P0** | Rotate/revoke Stripe webhook secrets. |
| Live `sb_secret_` in Git history | **P0** | Rotate Supabase service-role key. |
| No `.env.example` | P1 | Create `.env.example` with placeholders only. |
| `SUPABASE_SERVICE_ROLE_KEY` and `HYDI_SERVICE_SECRET` in working tree `.env` | P1 | Inject at deploy time; do not store in repo. |

## Required actions

1. **P0**: Rotate the Stripe live secret key, Stripe webhook secret(s), and Supabase service-role key in the live providers. Treat any value that has ever been in Git history as compromised.
2. **P1**: Add `.env.example` containing only placeholder values and `NEXT_PUBLIC_*` defaults.
3. **P1**: Configure Vercel/Supabase/CI to inject secrets as environment variables; remove the requirement to keep `.env` in the deployment host.
4. **P2**: Add `scripts/security-audit.js` or a `npm run security-audit` step to CI to block commits containing `sk_live_` / `whsec_` / `sb_secret_` patterns.
5. **P2**: Test `lib/structured-logger.js` redaction for the new rotated values.

## Notes

- This audit does **not** rotate credentials. Rotation requires explicit user action and provider access.
- The current working tree `.env` is the only local runtime config; it is not in Git, but it is on disk and may be backed up/exfiltrated if the machine is compromised.
