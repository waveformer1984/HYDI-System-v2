# Security Report

## Executive Summary

- **Static security audit (`npm run security-audit`):** PASS, 0 findings across `src/hydi-v3` and `src/HYDISystem.js`
- **KILO execution authority:** Machine-enforced — `execute()` throws unconditionally
- **ProtoForge default policy:** Fail-closed — `default: 'reject'`
- **API key gate (`SimpleKeymaker`):** Fail-closed — no configured keys → every POST is 401
- **Service-role key:** Present only in server-side `.env.local`; not in `components/`
- **Command execution surfaces:** `child_process` used in `supervisor.js`, `src/hydi-v3/ResourceManager.js`, `soak-chaos.js`, and operational qualification scripts; these require input-sanitization review
- **No secrets found** in `components/` or `pages/` non-API paths
- **One warning:** `src/database.js` logs the first 20 characters of `SUPABASE_SERVICE_ROLE_KEY` at boot

## 1. KILO — No Execution Authority

**File:** `kilo/index.js`

```js
execute() {
  throw new Error(
    'KiloEngine.execute() is forbidden. ' +
    'KILO is a hypothesis generator only (pipeline layer [4]). ' +
    'Pass hypotheses to ProtoForge (layer [5]) for policy evaluation and execution.'
  );
}
```

- **Verification:** Source read and runtime `require('./kilo/index.js')` both succeed.
- **Result:** Machine-enforced. Any code path that attempts `kilo.execute()` will fail before any side effect.

## 2. ProtoForge Policy Engine — Fail-Closed

**File:** `lib/protoforge/policy-engine.js`

- DSL operators are an explicit allow-list: `gte, lte, gt, lt, eq, neq, in, nin`
- Unknown operator throws `Unknown DSL operator: ${op}`
- Default decision is `'reject'`
- Runtime test performed:

```
low_conf : { decision: 'reject', matchedRuleId: null }
high_conf: { decision: 'approve', matchedRuleId: 'r1' }
```

- **Result:** Malformed/unknown requests deny, low-confidence hypotheses reject. This is fail-closed.

## 3. API Authentication

### `src/middleware/simple-keymaker.js`

- **No hardcoded keys.** Only `process.env.STARTER_API_KEY`, `PRO_API_KEY`, `ENTERPRISE_API_KEY` are accepted.
- **No key or invalid key → 401**
- **GET, `/health`, `/integrity`, `/infrastructure/*`, `/bare-test` are public**
- **With no keys configured (current state), every POST is rejected** — fail-closed.

### `src/middleware/keymaker.js`

- Uses `crypto` and Supabase-backed key validation.
- Missing `x-keymaker-key` header creates an anonymous identity.
- Invalid key → `401` with code `KEYMAKER_INVALID_KEY`.
- Has service registry with tiered access (`starter`, `pro`, `admin`).

### Permission-boundary caveat

- `services` registry includes `process` with `minTier: 'starter'` and comment `// Temporarily lowered for testing`. This lowers the tier gate for `/process` POSTs.
- If the access check is tier-only, this is a temporary over-privilege. If it also requires the `admin`/`user` role list, the impact is lower. Access logic should be reviewed before release.

## 4. Secret Management

| Check | Result |
|-------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` in `pages/api/*` | Server-side only; expected |
| `SUPABASE_SERVICE_ROLE_KEY` in `components/` | Not found |
| `STRIPE_SECRET_KEY` in `components/` or `pages/` | Not found |
| `.env` / `.env.local` tracked by git | **Ignored** — good |
| Hardcoded API keys in `SimpleKeymaker` | None |

**Caveat:**
- `src/database.js` prints the first 20 characters of `SUPABASE_SERVICE_ROLE_KEY` at startup:
  `console.log('[DATABASE] SUPABASE_KEY:', supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'MISSING');`
- This is a partial secret disclosure to `stdout`/`logs`. It should be reduced to `PRESENT / MISSING` without a token prefix.

## 5. Command Execution / Sandbox Isolation

`child_process` usage found:

| File | Usage | Risk |
|------|-------|------|
| `supervisor.js` | `spawn`, `exec` | High — core supervisor; inputs must be sanitized |
| `src/hydi-v3/ResourceManager.js` | `exec` | High — resource management; input validation needed |
| `scripts/soak-chaos.js` | `spawn`, `execFile` | Intentional — chaos test harness |
| `operational-qualification/orchestrator/stack-orchestrator.js` | `spawn` | Medium — operational qualification |
| `scripts/phase34/35-demo` | `exec` | Low — demo scripts |

**No `eval()` or `new Function()`** was found outside of test harness regex loops.
**`SecurityAuditor.js`** contains regex checks for `child_process` and `.exec(` anti-patterns, suggesting active defensive scanning.

**Recommendation:** Audit `supervisor.js` and `src/hydi-v3/ResourceManager.js` for user-controlled arguments being passed to `exec`/`spawn`.

## 6. Input Validation

- `lib/protoforge/policy-engine.js` rejects unknown DSL operators and defaults to `reject`.
- `kilo/index.js` validates payload is an object and validates repair manifests before processing.
- `SimpleKeymaker` checks for `x-api-key` header/query and validates against a key map.
- `Keymaker` validates against the `keymaker_keys` Supabase table (assumed by code).

## 7. Prompt Injection

- No dedicated prompt-injection guard was identified in the files inspected.
- The chat pipeline (`api/chat/route.js`) and `lib/claude.ts` were not exhaustively reviewed for prompt-hardening.
- **Recommendation:** Add or verify prompt-injection / output-filtering controls for the chat endpoint before accepting untrusted public input.

## 8. Static Security Audit Output

```json
{
  "timestamp": "2026-08-05T19:09:09.002Z",
  "scannedPaths": [
    "C:\\Users\\Owner\\HYDI_System\\src\\hydi-v3",
    "C:\\Users\\Owner\\HYDI_System\\src\\HYDISystem.js"
  ],
  "findings": [],
  "environmentVariables": {
    "present": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    "missing": ["NEXT_PUBLIC_SUPABASE_URL"],
    "exposedInPublic": {
      "NEXT_PUBLIC_SUPABASE_ANON_KEY": "missing",
      "NEXT_PUBLIC_SUPABASE_URL": "missing"
    }
  },
  "databasePermissions": {
    "rlsEnabled": true,
    "serviceRoleUsed": true,
    "anonRoleRestricted": true
  },
  "passed": true
}
```

## 9. Findings Summary

| # | Finding | Severity | Recommendation |
|---|---------|----------|----------------|
| 1 | KILO `execute()` throws unconditionally | **Positive** | Keep |
| 2 | ProtoForge default `reject` | **Positive** | Keep |
| 3 | SimpleKeymaker 401 with no keys | **Positive** | Keep; set keys in `.env.local` for real API access |
| 4 | Service-role key not in client code | **Positive** | Keep `.env.local` git-ignored |
| 5 | Partial `SUPABASE_SERVICE_ROLE_KEY` logged at boot | Low | Replace key-prefix log with `PRESENT/MISSING` |
| 6 | `/process` tier lowered for testing | Medium | Review and restore `pro`/`admin` tier before release |
| 7 | `child_process` in `supervisor.js` and `ResourceManager.js` | Medium | Audit for command-injection |
| 8 | No prompt-injection hardening identified | Medium | Review `api/chat/route.js` / `lib/claude.ts` |

## Commands Executed

```text
npm run security-audit
grep SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY in pages/ and components/
grep eval\(|new Function\(|child_process|\.spawn\(|\.exec\( in C:\Users\Owner\HYDI_System
node -e "... evaluateRules(...) ..." (lib/protoforge/policy-engine.js)
```

## Conclusion

The architecture is **fail-closed** where it matters: KILO cannot execute, ProtoForge defaults to `reject`, and the API key gate rejects unauthenticated POSTs. Secret exposure is minimal. The main security gaps are (1) partial key logging at boot, (2) a temporary tier-lowering for `/process`, and (3) `child_process` surfaces that need input-validation review. These are not release-blockers on their own, but they should be closed before production certification.
