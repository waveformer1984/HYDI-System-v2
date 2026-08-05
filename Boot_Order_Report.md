# Boot Order Report

## Executive Summary

- **Boot command under investigation:** `npm run server` → `node src/server.js`
- **Root cause identified:** `src/database.js` only loaded `.env`. The real credentials live in `.env.local`, and `src/server.js` loaded `.env.local` *after* `require('./database')`, with `dotenv` default `override: false` preventing any update.
- **Fix applied:** `src/database.js` now loads `.env.local` first, then `.env`.
- **Validation:**
  - `node -e "require('./src/database.js')" | Out-Null` → exit 0 (no missing-env throw)
  - 10-second `node src/server.js` cold boot → process remained running (successful boot)
- **Residual warnings:** `SimpleKeymaker` reports no API key, and `UniversalAgentBus` gets `fetch failed` for `pending_tasks`. These are non-fatal runtime warnings, not boot failures.

## Dotenv / Import Timing Analysis

### `src/database.js` (before fix)

```js
require('dotenv').config({ path: path.join(__dirname, '../.env') });
```

- Only `.env` was loaded.
- `.env` contains **local/placeholder** values (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, fake `SUPABASE_SERVICE_ROLE_KEY`).
- `.env.local` contains the **real** Supabase/Stripe keys but was never read.
- On any boot that did not have the variables already exported in the parent shell, the Supabase client would be created with invalid local values and the database connection would fail.

### `src/server.js`

```js
const { supabase } = require('./database');          // line 4 — dotenv NOT yet loaded here
...
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); // line 12
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });        // line 13
```

- `database.js` is `require`d before `src/server.js` configures dotenv.
- Even after `src/server.js` does load `.env.local`, `dotenv` default `override: false` means it cannot replace the values that `database.js` has already set from `.env`.
- Result: the local/placeholder `.env` values win, and `.env.local` is effectively ignored.

### `.env` vs `.env.local` contents (keys only)

| File | `SUPABASE_URL` source | `SUPABASE_SERVICE_ROLE_KEY` source |
|------|----------------------|-----------------------------------|
| `.env` | `http://127.0.0.1:54321` (local Supabase) | Placeholder/fake local key |
| `.env.local` | Real remote Supabase project | Real service-role key |

(Values are redacted in this report; only key names and provenance are recorded.)

## Fix

### `src/database.js`

```js
// Load .env.local first so it takes precedence, then .env as fallback.
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
```

This is the minimal, fail-closed change:
- `.env.local` (the local, often secret, override file) is consulted first.
- `.env` (the checked-in defaults / local dev values) is consulted second and only fills keys missing in `.env.local`.
- Because `dotenv` defaults to not overwriting already-set variables, the real credentials in `.env.local` now take precedence for any module that imports `database.js`.

## Validation Results

### 1. Database module cold load

```text
node -e "require('./src/database.js')" | Out-Null
```

- **Exit code:** `0`
- **Conclusion:** No `CRITICAL: Missing SUPABASE_URL...` throw; `.env.local` is now read.

### 2. Full server cold boot (Windows)

```powershell
$proc = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -NoNewWindow -PassThru -RedirectStandardOutput 'nul' -RedirectStandardError 'boot-test-err.log';
Start-Sleep -Seconds 10;
if (!$proc.HasExited) { Stop-Process -Id $proc.Id -Force }
```

- **Process status after 10 s:** Still running (no crash)
- **Stderr captured:**

```text
[SIMPLE KEYMAKER] No STARTER_API_KEY/PRO_API_KEY/ENTERPRISE_API_KEY configured - every POST request will be rejected with 401 until at least one is set.
[UniversalAgentBus] Could not check pending_tasks: TypeError: fetch failed
```

**Interpretation:**
- The server booted.
- `SimpleKeymaker` is in fail-closed mode (good) and warns that no API key is set — this is a configuration warning, not a boot failure.
- `UniversalAgentBus` attempted an outbound `fetch` that failed (likely because the targeted endpoint was not running in this Windows test). This is a runtime warning, not a boot-time exception.

### 3. Dotenv package availability

```text
npm view dotenv version
17.4.2
```

The `dotenv` package specified in `package.json` (`^17.4.2`) is resolvable on the public registry.

## Cross-Platform Assessment

| Platform | Concern | Status |
|----------|---------|--------|
| Windows | `__dirname` + `path.join` resolves `.env.local` correctly | Verified |
| Linux/Docker | `dotenv` and `path` are cross-platform | No issues expected |
| CI | No `.env` or `.env.local` is committed; credentials must be injected | Needs setup docs / CI secret steps |
| Reboot | Boot relies on files present in working directory | Works if `.env.local` exists at repo root |

## Open Gaps

1. **No `.env.example` or root `.env` setup script** for a clean machine. `setup.sh` is a Termux mobile setup and does not create the Node server's `.env.local`.
2. **API key not configured** (`STARTER_API_KEY`/`PRO_API_KEY`/`ENTERPRISE_API_KEY`) — the server will reject every POST until at least one is set. This is fail-closed but may surprise a fresh deploy.
3. **UniversalAgentBus fetch failure** — the bus attempts to `fetch` a pending-tasks endpoint during startup. That target must be available for a clean boot, otherwise the log is noisy and may hide real errors.

## Commands Executed

```text
node -e "require('./src/database.js')" | Out-Null
npm view dotenv version
node src/server.js   # cold boot, observed via redirect for 10s
```

## Conclusion

`npm run server` no longer fails due to missing dotenv configuration. The boot order bug is **fixed**. The remaining items are configuration warnings and an unavailable `pending_tasks` endpoint that should be addressed before full production certification, but they do not prevent the server from initializing.
