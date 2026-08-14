# Git History Secret Remediation

Date: 2026-08-14
Branch: `release/v0.9.0`

## Assessment

### Is Git history cleanup necessary?

| Factor | Finding |
|---|---|
| Repository visibility | This repository has been used in a Vercel/WSL/CI context. The full commit graph has likely been shared with GitHub, CI runners, and possibly forks. |
| Credential validity | The exposed credentials (`sk_live_...`, `whsec_...`, `sb_secret_...`) appear to be real, valid-format secrets. They must be treated as compromised. |
| Access | Multiple historical commits and branches have touched these files. Anyone with prior access to the repository or GitHub has had read access. |
| Provider-side control | Stripe and Supabase allow rotation/revocation. This is the **primary** and most reliable control. |

### Conclusion

**Provider-side rotation is the required control.** Git history cleanup is **optional** and should be weighed against risk, effort, and coordination cost.

## Why history cleanup might be recommended

- Even after provider rotation, the old values remain in the Git graph indefinitely.
- If the repository is public or becomes public, an attacker could mine old commits for other information or patterns.
- Defense-in-depth: removing the values from the graph reduces long-term exposure surface.

## Risks of history rewriting

- **Force-push required** on every affected branch (`clean-main`, `release/v0.9.0`, and any others).
- **All tags** referencing affected commits must be recreated or updated.
- **Open PRs and CI** must be re-targeted.
- **Forks and local clones** become invalid and must be re-cloned.
- **Commit hashes** in reports, runbooks, and the audit trail will change, invalidating the immutable audit ledger HYDI relies on.
- **Rewriting history does not revoke credentials at the provider.** It only removes the copy in the repo.

## Affected commits

The following example commits (hashes abbreviated) have been identified by `git log --all -S <pattern>` as containing `sk_live_`, `whsec_`, or `sb_secret_` patterns. This is not an exhaustive list; a full scan with `git log --all -S` will reveal additional commits and branches.

| Credential class | Example historical commits | Example files |
|---|---|---|
| `sk_live_` | `8c2f4dc5...` | `supabase/functions/.env.production` |
| `whsec_` | `67781b77...`, `8c2f4dc5...`, `aa0d8206...`, `aa5b514a...` | `test-webhook.js`, `supabase/functions/.env.production`, `vercel-sync-analysis.md` |
| `sb_secret_` | `db5bcbcb...`, `795879ec...`, `f391c25c...`, `1aa78d54...`, `cb4ddc97...` | `heidi-core/HEIDI.ps1`, `check-*.js`, `task-*.js`, `test-*.js`, `configure-vault.js`, `setup-vault.js` |

## Required coordination

If history rewriting is authorized, the following must happen before any force-push:

1. **Coordinate with all contributors** — require them to delete local clones and re-clone.
2. **Coordinate with CI** — update all workflow references that pin commit hashes.
3. **Coordinate with release/tags** — recreate any tags that should remain valid (e.g., `v0.9.0-rc.*` must not be moved per existing instructions).
4. **Coordinate with deployment** — Vercel/GitHub must re-link to the new commit graph.
5. **Back up the current repository** — create a bare clone before rewriting.
6. **Verify** with a full `git log` and secret scan on the rewritten graph.

## Recommended approach

1. **Primary control**: Rotate/revoke the credentials at Stripe and Supabase **first**.
2. **Secondary control (optional)**: If the repository is or will become public, or if the exposure is high-value, then perform `git filter-repo` to remove the secret values from all branches and tags.
3. **If history is rewritten**:
   - Do **not** rewrite frozen tags (`v0.9.0-oq-cert.2`, etc.). Create new tags instead.
   - Force-push to `clean-main` only after all stakeholders confirm.
   - Update all documentation/reports that reference old commit hashes.

## Verdict

- **History rewrite is not required before rotation.**
- **History rewrite is recommended only if** the repository will be made public or a defense-in-depth cleanup is desired.
- **Authorization is required** from the repository owner before any force-push or tag movement.
