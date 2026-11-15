# Frank local-CI closure report

**Incident:** `local-ci/unit-tests` and `local-ci/integration-tests` fail at lint on DESKTOP-I719OIN while `local-ci/typecheck` passes.

## Audit: PR #600 vs #601

| Item | PR #600 (`92909393`) | PR #601 (`99731d90` + `beed9ee4`) |
|------|----------------------|-------------------------------------|
| `ciChildEnv()` | Yes | **Same commit** cherry-picked (`99731d90`) |
| `local-ci.test.js` | Yes | Yes |
| Extra coverage | Docs only | `frank-truth-loader`, revenue, fabric tests |
| GHA required checks | Pass (lint, jest, integration, CodeQL) | Pending / not yet reported |
| Codecov patch | **FAIL** | Expected **pass** (more executable lines in diff) |

**Conclusion:** #601 **fully incorporates** the local-CI fix. #600 Codecov failure is a **patch-coverage artifact** (large markdown/architecture docs, few executable lines in that PR’s patch).

## `ciChildEnv()` behavior

- Copies `process.env` + `extraEnv`, sets `CI: 'true'`
- **Deletes only** `ESLINT_USE_FLAT_CONFIG`
- All other env vars preserved (including `SUPABASE_*` injected per check)

## Merge recommendation

1. **Approve merge of #601** (or #600 then fast-follow #601).  
2. **Do not** mark incident closed until Frank verification below succeeds.

## Frank verification (mandatory)

See `FRANK_LOCAL_CI_VERIFICATION.md`. Summary:

```powershell
pm2 restart hydi-local-ci --update-env
node scripts/local-ci.js <clean-main-sha>
```

Exit code **0** and green GitHub statuses for all three `local-ci/*` contexts.

## Status

**ROOT CAUSE IDENTIFIED — FIX NOT VERIFIED ON FRANK**