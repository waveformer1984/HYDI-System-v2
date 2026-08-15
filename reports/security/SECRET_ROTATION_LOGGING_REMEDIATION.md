# Secret Rotation Logging Remediation

## Finding

Several repository scripts were logging newly generated or partially rendered secret values to `stdout`:

| File | Leakage |
|---|---|
| `rotate-secrets.js` (root) | `console.log` of `NEW BREAK-GLASS TOKEN: <value>` and `NEW SERVICE ROLE KEY: <value>` |
| `generate-new-token.js` (root) | `console.log` of the raw 64-character hex token |
| `update-credentials.js` (root) | `console.log` of `Service Role: <first 20 chars>...` and `Anon Key: <first 20 chars>...` plus the Supabase URL |
| `phase2-vault-check.js` (root) | `console.log` of `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20)` |

The root cause in each case was the use of `console.log` with a template string that included secret material. No structured logger or redaction layer was present.

## Exposure

The following credential categories may have been exposed by these code paths:

* `KEEPER_BREAK_GLASS_TOKEN` (random 32-byte hex)
* `SUPABASE_SERVICE_ROLE_KEY` (random 32-byte hex, or the real Supabase key when present)
* `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT-shaped key)
* `SUPABASE_URL`

Actual values are not included in this report. The scripts were designed for interactive operator use, so any prior execution could have written these values to shell history, terminal scrollback, CI logs, or copied-and-pasted output.

## Remediation

The affected files were modified so that secret values are never emitted:

| File | Change |
|---|---|
| `rotate-secrets.js` | Removed `console.log` of token values; now logs only identifiers and timestamp; added `module.exports` and `require.main` guard; supports `ROTATION_TEST_*` env overrides for deterministic testing |
| `generate-new-token.js` | Removed `console.log` of token value; now logs only `TOKEN ID` and timestamp; supports `GENERATE_TOKEN_TEST_SECRET` for testing |
| `update-credentials.js` | Removed logging of URL and partial key substrings; now logs only that each value was updated |
| `phase2-vault-check.js` | Removed logging of secret values and partial substrings; now logs only whether each named secret is missing |

No other rotation/verification scripts were found that log actual secret values.

## Rotation / Revocation Status

The generation/rotation scripts are now safe, but the repository cannot automatically revoke or rotate live Supabase or Vercel credentials in this environment. Manual action is required.

| Identifier | Status |
|---|---|
| `KEEPER_BREAK_GLASS_TOKEN` | **ROTATION REQUIRED** — revoke old value and generate a new one in Supabase/Vercel if it may have been logged previously |
| `SUPABASE_SERVICE_ROLE_KEY` | **ROTATION REQUIRED** — regenerate in Supabase Dashboard if it may have been logged previously |
| `SUPABASE_ANON_KEY` | **ROTATION RECOMMENDED** — rotate if the URL/key was previously printed |

Actual rotation must be performed by an operator with appropriate Supabase and Vercel access. New values must not be logged, reported, or committed.

## Verification

Added `tests/unit/secret-rotation-safety.test.js`:

* Runs `rotate-secrets.js` with `ROTATION_TEST_BREAK_GLASS_TOKEN` and `ROTATION_TEST_SERVICE_ROLE_KEY` set to synthetic test values.
* Asserts the test values do **not** appear in stdout.
* Asserts metadata (e.g., "values intentionally not logged", identifiers) does appear.
* Runs `generate-new-token.js` with `GENERATE_TOKEN_TEST_SECRET` and asserts the value does not appear in stdout.

Test result:

```text
PASS tests/unit/secret-rotation-safety.test.js
  secret rotation scripts do not leak values
    √ rotate-secrets.js does not log the generated break-glass or service role values
    √ generate-new-token.js does not log the generated token value

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

Full regression:

```text
npm run typecheck   PASS
npm test            PASS — 263/263 suites, 2505/2506 tests, 1 skipped
```

## Residual risk

* **Historical log exposure:** Any previous run of `rotate-secrets.js`, `generate-new-token.js`, `update-credentials.js`, or `phase2-vault-check.js` may have written secrets to terminal scrollback, shell history (`~/.bash_history`, `~/.zsh_history`, PowerShell history), CI build logs, Docker logs, or copied messages. These must be purged or the affected credentials revoked.
* **`.env.backup` from `update-credentials.js`:** The file creates a backup of `.env` at `.env.backup`. If that backup contains real credentials, it must be protected or removed.
* **PowerShell `rotate-secure.ps1`:** Already does not print the token, but it passes the value through an environment variable and the `supabase secrets set` command line. Operators should ensure the command-line argument is not captured by shell history.
* **No automated credential rotation:** The scripts still require manual steps in the Supabase/Vercel dashboard. The repository cannot perform full rotation unattended.

## Log-retention exposure assessment

| Location | Risk | Action |
|---|---|---|
| Local shell history | High if scripts were run in an interactive shell | Clear or rotate if compromised |
| CI/CD logs | High if these scripts ran in CI | Scrub or rotate if exposed |
| Docker logs | Medium if the script was run inside a container | Scrub or rotate |
| `.env.backup` | High if file was written | Remove or protect |
| Terminal scrollback | Medium | Clear if exposure suspected |
| Cloud logging | Medium if CI/cloud shell used | Scrub or rotate |

The primary containment is credential rotation. Log scrubbing is secondary and should only be performed in a controlled manner; credential revocation makes old log entries harmless.
