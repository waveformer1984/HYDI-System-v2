# PM2 Secret Exposure — Classification & Remediation Plan

**Author:** Agent G (PM2 SECRET EXPOSURE), CODE TRACK — read-only analysis
**Date:** 2026-09-18
**Scope:** `C:\Users\Owner\.pm2\dump.pm2`, `C:\Users\Owner\.pm2\dump.pm2.bak`, and all other plaintext secret stores discovered during the investigation.
**Constraint honored:** No secret values are reproduced anywhere in this document. Variable names and structural classifications only. No live actions were taken: no dumps deleted, no env vars changed, no PM2 restart, no `.env` edits.

---

## 1. Executive summary

`C:\Users\Owner\.pm2\dump.pm2` (139 KB, last written 2026-09-12) persists the **entire ambient Windows user environment** of the PM2 daemon into every managed process entry — once flattened at the top level of each app object and again inside a nested `env` object. With 8 managed apps, each secret value appears **up to 16 times** inside this one file. `dump.pm2.bak` (161 KB) contains the same secrets **plus** an additional set of variables inherited from a VS Code / Claude Code session context.

**Root cause:** the secrets are not in `ecosystem.config.js` (verified — it sets only `NODE_ENV`, `HYDI_DELEGATE_RECOVERY`, and interval timers). They are **persistent user-level environment variables** stored in plaintext at `HKCU:\Environment`. PM2 inherited them when the daemon spawned the apps, froze them into each app's recorded env, and `pm2 save` wrote them to disk. `pm2 resurrect` (run at every user logon by the **`PM2Resurrect` scheduled task**, confirmed: Action = `pm2 resurrect`, Trigger = logon, Enabled) replays them from the dump on every boot.

**Severity assessment:** the credentials with real power are mostly **local-scoped** — `SUPABASE_URL` in the dump points at `http://127.0.0.1:54321` (Supabase CLI local dev), and the two Supabase JWTs carry `iss=supabase-demo`, i.e. they are the **publicly documented local-demo keys**, not production credentials. The two genuinely suspicious items are `GEMINI_API_KEY` (high-entropy, real-looking, used by the Rezonate generation path) and `MY_SECRET_TOKEN` (high-entropy, **zero consumers in this repo** — an ambient foreign credential). Everything else is placeholder, publishable-by-design, or non-secret config.

---

## 2. Exposure surface map

| # | Location | Contents | Readable by |
|---|----------|----------|-------------|
| 1 | `C:\Users\Owner\.pm2\dump.pm2` | Full user env ×8 apps ×2 copies (flat + `env` object) | Any process running as `Owner`; any backup/sync agent sweeping the profile |
| 2 | `C:\Users\Owner\.pm2\dump.pm2.bak` | Same + extra session vars (Claude Code/VS Code context, incl. a session token) | Same |
| 3 | `HKCU:\Environment` (registry) | The same secrets as persistent user env vars — **the actual source** | Any process as `Owner`; persists in `NTUSER.DAT` and its backups |
| 4 | `HYDI-System-v2\.env` | `HEIDI_SECRET`, `KEEPER_BREAK_GLASS_TOKEN`, `URSULA_URL`, ports | Same (git-ignored ✓) |
| 5 | `HYDI-System-v2\.env.local` | `SUPABASE_SERVICE_ROLE_KEY` (different value than dump — `sb_secret`-era format), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `STRIPE_SECRET_KEY` (`sk_test`), `STRIPE_WEBHOOK_SECRET_01` (`whsec_`), `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `HYDI_SERVICE_SECRET`, `ALLOW_LIVE_STRIPE` | Same (git-ignored ✓) |
| 6 | `HYDI-System-v2\.env.bak-akbnfovjdcobifeupvbn` | A **different** `SUPABASE_SERVICE_ROLE_KEY` (longer JWT shape) + a different non-local `SUPABASE_URL` — looks like a stale **hosted/production** Supabase credential | Same (git-ignored ✓, but should be deleted) |
| 7 | `HYDI-System-v2\.env.local.cloud-backup` | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`, `SUPABASE_ANON_KEY` (local Supabase values) | Same (git-ignored ✓) |
| 8 | `HYDI-System-v2\.env.example` — **git-tracked** | An `OPENAI_API_KEY` value that is `sk-` prefixed, 64 chars, no placeholder words — **cannot be confirmed fake without disclosure; flagged for live review** | Anyone with repo read access + git history |
| 9 | `HYDI-System-v2\tmp-secret-test.txt` | Contains a real `whsec_`-format Stripe webhook secret in plaintext | Same |
| 10 | Windows user env → **every spawned child** | Any tool/script the user launches inherits these vars silently | n/a |

### Negative results (checked, clean)

- `C:\Users\Owner\.pm2\pm2.log` (126 MB): **0 lines** contain any secret variable name.
- All 114 log files under `.pm2\logs\` and `HYDI-System-v2\logs\`: scanned with a 16-char middle-fingerprint of every dump secret — **no secret values found** (head+tail chunks of the >60 MB logs included).
- PM2 does **not** echo env into `pm2.log` or per-app logs on this system.
- `.env`, `.env.local`, `.env.bak-*`, `.env.local.cloud-backup` are all covered by `.gitignore` (verified via `git check-ignore`).
- No `STRIPE_*`, `VAPID_*`, `HEIDI_SECRET`, `HYDI_SERVICE_SECRET`, `KEEPER_*`, `ANTHROPIC_API_KEY` in the current dump (they exist only in `.env*` files and/or the user env — **`ANTHROPIC_API_KEY` is now in `HKCU:\Environment` and will enter the dump on the next `pm2 save`/fresh start**).

---

## 3. Variable inventory & classification

All values identical across the 8 dumped processes (a single ambient env snapshot). `dump.pm2.bak` holds identical values for all of these plus the extras in §3.3.

### 3.1 Secret-looking variables in `dump.pm2`

| Variable | Source location | Exposure class | Consumer(s) | Remediation state |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `HKCU:\Environment` → dump | **local-only** — JWT, `iss=supabase-demo`, `role=service_role`, exp 2032; pairs with `SUPABASE_URL=http://127.0.0.1:54321`. Publicly-documented local-dev key shape. NOTE: differs from `.env.local`'s value (newer `sb_secret`-era format) | `scripts/system-health-scheduler.js:88-91`, `scripts/stuck-job-scheduler.js:58-71`, `scripts/protoforge-opportunity-scheduler.js:90-92`, `scripts/failed-webhook-scheduler.js:30-33`, `scripts/revenue-reconciliation-scheduler.js:28-31`, `scripts/heidi-daemon.ts:614-616`, `scripts/boot-agent.js` preflight (`boot.config.json:8` requiredEnv), plus ~90 repo files reading it via dotenv/inherited env | Remove from user env; source from `.env.local` via dotenv; `filter_env` in ecosystem config |
| `SUPABASE_KEY` | `HKCU:\Environment` → dump | **local-only** — identical shape/role as above (service_role demo JWT, alias) | `.env.local.cloud-backup`, assorted setup/audit scripts (`configure-vault.js`, key-audit scripts) | Same as above |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | `HKCU:\Environment` → dump | **publishable-by-design** (`sb_publishable_` format, 46 chars) — designed to ship to browsers | `next.config.js` env passthrough pattern, `utils/supabase/{client,server,middleware}.ts`, `lib/orchestrator.ts`, `lib/ModelManager.ts`, `workers/*` (~20 files), `apps/ursula-frontend` | No rotation needed; remove from dump anyway via `filter_env`; keep in `.env.local` |
| `GEMINI_API_KEY` | `HKCU:\Environment` → dump | **suspect live credential** — 55-char high-entropy opaque token, no placeholder markers. Cannot verify validity offline | `rezonate/generate.py:33-52` (Rezonate AI song generation, Google Lyria), `src/models/local-model-adapter.js:46`, `src/models/HybridModelStack.js:68` | **Verify & rotate if live** (§8.2); move to `.env.local`/DPAPI store |
| `MY_SECRET_TOKEN` | `HKCU:\Environment` → dump | **suspect live credential, foreign** — 82-char high-entropy token; **zero consumers anywhere in this repo** — belongs to another tool on this machine | None in repo | Identify issuer, rotate if real, remove from user env |
| `OPENAI_API_KEY` | `HKCU:\Environment` → dump | **placeholder** — `sk-` prefixed but 18 chars, alphabetic placeholder words, low entropy; `ModelManager.isRealApiKey()` (lib/ModelManager.ts:410-417) would reject it (len < 20) | `lib/ModelManager.ts:377,402,426` (rejected as placeholder), `pao-system/services/llm.service.ts`, `.env.example` (different value, see §8.5) | Remove from user env; no rotation needed |
| `NOTION_TOKEN` | `HKCU:\Environment` → dump | **placeholder** — 10 chars, placeholder words, low entropy | No live consumers (docs/tests only) | Remove from user env |
| `GOOGLE_API_KEY` | `HKCU:\Environment` → dump | **placeholder** — 15 chars, placeholder words | `rezonate/generate.py:33,51-52` (fallback env the script deliberately strips) | Remove from user env |
| `MINIMAX_API_KEY` | `HKCU:\Environment` → dump | **placeholder** — 12 chars, placeholder words | No repo consumers | Remove from user env |
| `ELEVENLABS_API_KEY` | `HKCU:\Environment` → dump | **placeholder** — 19 chars, placeholder words | No live consumers | Remove from user env |
| `SUPABASE_URL` | `HKCU:\Environment` → dump | **config, non-secret** — `http://127.0.0.1:54321` (local Supabase) | Every Supabase consumer above | Keep in `.env.local`; harmless in env |
| `URSULA_URL` | `HKCU:\Environment` → dump | **config, non-secret** — `https://ursula-nine.vercel.app` | `modules/deployment-manager.js:413`, `heidi-bridge*.py`, archive scripts | Remove from user env or leave (non-secret) |
| `HEIDI_TOOL_MODEL` | `HKCU:\Environment` → dump | **config** — local Ollama model name | `heidi-core/server.js:532` | Non-secret |
| `CHAT_PUSH_NOTIFICATIONS` | `HKCU:\Environment` → dump | **config flag** — boolean; no repo consumers | None | Non-secret |
| `HYDI_DELEGATE_RECOVERY` | `ecosystem.config.js` `env:` block | **config flag** | `scripts/boot-agent.js:84`, `scripts/watchdog.js:99`, `heidi-core/missions/health-observer.js:136` | Keep — legitimately in ecosystem config |
| `CLAUDE_AGENT_SDK_VERSION` | ambient session var | **config** — version string (JWT-regex false positive; 3 dot-segments) | Agent tooling | Non-secret |
| `OLLAMA_*` (6 vars), `LAUNCH_*`, `GOPATH`, `HF_HOME`, etc. | `HKCU:\Environment` | **config/system** | Local model stack | Non-secret |

### 3.2 Additional variables only in `dump.pm2.bak`

`.bak` was captured from a different launch context (VS Code / Claude Code terminal). Notable additions:

| Variable | Class | Note |
|---|---|---|
| `CLAUDE_CODE_MESSAGING_TOKEN` | **ephemeral session token** (32-char opaque) | Almost certainly expired with its session; still a token-shape artifact on disk → include `.bak` in sanitization |
| `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_SCOPES`, `SENTRY-TRACE`, `BAGGAGE`, `USE_LOCAL_OAUTH`, `USE_STAGING_OAUTH`, `GIT_ASKPASS`, `AI_AGENT` | config/telemetry | Non-secret but increase dump surface |
| `VSCODE_*`, `WINDSURF_*`, `EFC_*`, `CLAUDE_*` (30+ vars) | session/environment noise | Demonstrates the dump captures whatever the spawning shell held |

### 3.3 Rotation classification summary

| Class | Variables | Rotation? |
|---|---|---|
| Live-real / suspect | `GEMINI_API_KEY`, `MY_SECRET_TOKEN` | **Yes — verify then rotate** (§8.2) |
| Local-only public demo | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (all → 127.0.0.1:54321) | No external rotation; remove from dump |
| Placeholder | `OPENAI_API_KEY`, `NOTION_TOKEN`, `GOOGLE_API_KEY`, `MINIMAX_API_KEY`, `ELEVENLABS_API_KEY` | No |
| Ephemeral (.bak only) | `CLAUDE_CODE_MESSAGING_TOKEN` | No (expired); purge `.bak` |
| Non-secret config | `SUPABASE_URL`, `URSULA_URL`, `HEIDI_TOOL_MODEL`, `CHAT_PUSH_NOTIFICATIONS`, `HYDI_DELEGATE_RECOVERY`, `OLLAMA_*`, `CLAUDE_AGENT_SDK_VERSION` | n/a |

---

## 4. Is `dump.pm2` required for startup?

**Yes, on the current boot path.** A `PM2Resurrect` scheduled task (State: Ready, Trigger: logon, Enabled) executes `pm2 resurrect`, which restores the saved process list **and their recorded environments exclusively from `dump.pm2`**. If the file is missing/empty at logon, resurrect starts nothing — the 8 apps stay down until `pm2 start ecosystem.config.js` is run manually and `pm2 save` rewrites the dump.

Important mechanics that shape remediation:

- `pm2 restart <app>` reuses the env **recorded in the dump**, not the current shell env (unless `--update-env` is passed). Deleting user env vars alone does not propagate to existing PM2 apps.
- `pm2 delete` + `pm2 start ecosystem.config.js` re-reads the config and the daemon's current env → this is the only path that applies `filter_env` / new env policy.
- `pm2 save` rewrites `dump.pm2` from the in-memory process table — it must be run **after** sanitization to make the dump itself clean.
- `pm2 cleardump` empties the dump without touching running processes (useful if a gap in auto-start is acceptable).
- `scripts/pm2-restart.js` already implements the delete+start workaround for the Windows PM2 stale-ID bug — it never calls `pm2 save`, so restarts do not silently re-persist env (but the *next manual* `pm2 save` would).

---

## 5. How each PM2 app actually gets its secrets

| App | Loads `.env.local`/`.env` itself? | Secret dependency |
|---|---|---|
| `hydi-boot` (`scripts/boot-agent.js:46-53`) | **Yes** — dotenv `.env.local` → `.env`; children spawned with `{...process.env, ...resolvedEnv}` (line 238); Next.js child also self-loads `.env.local` | `.env.local` is authoritative |
| `hydi-watchdog` (`scripts/watchdog.js`) | **No** — reads `WATCHDOG_WEBHOOK_URL`, `HYDI_DELEGATE_RECOVERY` only; polls localhost health endpoints | No secrets needed (delegation flag comes from `env:` block) |
| `hydi-daemon` (`heidi-daemon-launcher.js` → `heidi-daemon.ts:28-31`) | **Yes** — launcher adds nothing; daemon dotenv-loads `.env.local` + `.env`, and re-reads `.env.local` every cycle (line ~299) | `.env.local` |
| `hydi-system-health` (`system-health-scheduler.js`) | **No** — reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` straight from `process.env` (lines 88-91) | **Depends on injected env today — needs dotenv added** |
| `hydi-protoforge-scout` (`protoforge-opportunity-scheduler.js`) | **No** — reads `SUPABASE_*` from `process.env` (lines 90-92); spawned mission child `scripts/missions/protoforge-daily-opportunity-scan.js` **does** self-load dotenv | **Needs dotenv added** |
| `hydi-stuck-job-scheduler` (`stuck-job-scheduler.js`) | **No** — `process.env.SUPABASE_SERVICE_ROLE_KEY` required (lines 58-71) | **Needs dotenv added** |
| `hydi-revenue-reconciliation` (`revenue-reconciliation-scheduler.js:18`) | **Yes** — `.env.local` | `.env.local` (see caveat) |
| `hydi-failed-webhook-retry` (`failed-webhook-scheduler.js:19`) | **Yes** — `.env.local` | `.env.local` (see caveat) |

**Caveat (must verify in live phase):** dotenv does **not** override already-set `process.env` vars. Today the ambient user-env `SUPABASE_SERVICE_ROLE_KEY` (local demo JWT) wins everywhere, even in dotenv-loading scripts. After `filter_env` removes the ambient vars, `.env.local`'s **different** `sb_secret`-era key becomes effective. That key must be verified to work against `http://127.0.0.1:54321` before cutover (§8.1 precondition).

---

## 6. CODE remediation plan

Ordered by dependency. Items 6.1–6.4 are pure code/config changes; live execution is deferred to §8.

### 6.1 Add a shared env loader and use it in the scripts that lack one

Create `scripts/lib/load-env.js`:

```js
// Single canonical env loader for PM2-managed scripts.
// Mirrors boot-agent.js order: .env.local (authoritative) then .env (fallback).
// dotenv never overrides already-set process.env vars.
const path = require('path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (_) { /* dotenv optional */ }
```

Then add `require('./lib/load-env');` as the first import in:

- `scripts/system-health-scheduler.js`
- `scripts/stuck-job-scheduler.js`
- `scripts/protoforge-opportunity-scheduler.js`
- `scripts/watchdog.js` (defense-in-depth; it currently needs no secrets but RecoveryEngine paths may)

`heidi-daemon.ts` already loads both files; switch it to the shared loader only if desired (it also re-reads `.env.local` per cycle — keep that behavior).

### 6.2 `ecosystem.config.js`: add `filter_env` to every app

PM2's `filter_env` (documented: boolean | string | string[]) excludes inherited/global env vars whose names **contain** the given strings; `true` drops all globals. `filter_env: true` is **not** recommended here — it would strip `Path`, `SystemRoot`, `windir`, `ComSpec`, which Windows child spawning (`npm run dev`, `npx tsx`, `node` children in boot-agent) needs.

Recommended: a targeted substring denylist per app:

```js
const ENV_DENYLIST = [
  'KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'PRIVATE',
  'SUPABASE', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'GOOGLE_API',
  'NOTION', 'ELEVENLABS', 'MINIMAX', 'STRIPE', 'WHSEC', 'VAPID',
  'OAUTH', 'MESSAGING', 'CREDENTIAL', 'BREAK_GLASS',
];
// ...
env: { /* existing non-secret vars */ },
filter_env: ENV_DENYLIST,
```

Effect: PM2 stops injecting ambient user-env secrets into app env; `dump.pm2` regenerated after restart+save contains only the explicit `env:`/`env_production:` values (`NODE_ENV`, `HYDI_DELEGATE_RECOVERY`, interval timers) plus filtered system vars — **no secret material**.

Verify-after-change: `node -e "JSON.parse(require('fs').readFileSync(process.env.USERPROFILE+'/.pm2/dump.pm2'))"` — assert no dumped env key matches the denylist.

### 6.3 Shrink what the user env broadcasts (requires live §8.1)

The real fix for the class of bug is at the source: secrets should not live in `HKCU:\Environment` at all — every process the user launches inherits them silently (PM2 just happened to persist them). HYDI-owned vars (`SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `URSULA_URL`, `HEIDI_TOOL_MODEL`, `GEMINI_API_KEY`, `MY_SECRET_TOKEN`, placeholders) belong in `.env.local`. Tool-specific keys CLIs genuinely need (`ANTHROPIC_API_KEY`, etc.) may stay — that's an accepted-risk decision for the owner, documented here.

### 6.4 Longer-term: DPAPI-backed secret store

Replace plaintext `.env.local` secrets with a DPAPI-encrypted store readable only by user `Owner` on this machine:

- Store: `C:\Users\Owner\.hydi\secrets.json.dpapi` — JSON encrypted via `CryptProtectData` (PowerShell `ConvertFrom-SecureString` produces a DPAPI blob; a small `scripts/lib/secure-store.js` wraps encrypt/decrypt through `powershell -Command` or the `win-dpapi`/`node-dpapi` package).
- Loader: `load-env.js` (6.1) gains a second stage — after dotenv, decrypt the DPAPI file and inject only missing vars. Fallback to `.env.local` keeps dev flow unchanged.
- Alternative: Windows Credential Manager via `cmdkey`/the `wincred` API — viable but per-credential and clunky for ~10 keys; DPAPI file is simpler and migrates cleanly.
- Consumers that need it (`rezonate/generate.py` for `GEMINI_API_KEY`) get a `--env-file`-style bootstrap or read via a tiny Python DPAPI helper (`win32crypt.CryptUnprotectData`).

### 6.5 Adjacent hygiene (code track)

- `.env.example` (git-tracked) contains an `OPENAI_API_KEY` value that is `sk-` + 61 lowercase/digit chars — atypical for a real key but **unverifiable without disclosure**. Live step: check validity; if real → rotate + scrub git history (BFG/`git filter-repo`); if fake → rewrite it to an obvious `<your-openai-key>` placeholder either way to end the ambiguity.
- `tmp-secret-test.txt` (repo root) contains a real `whsec_` token → secure-delete; add `tmp-*.txt` to `.gitignore` if not covered.
- `.env.bak-akbnfovjdcobifeupvbn` holds what appears to be a **stale hosted/production** Supabase service-role JWT + remote `SUPABASE_URL` → delete after confirming nothing references it; if that project is still live, rotate that key too (it's been sitting in a loose file).
- Consider `pm2 set pm2:discreet_mode true` to keep PM2 itself quieter in logs/CLI output.
- Optional CI guard: a unit test asserting `ecosystem.config.js` contains `filter_env` and no `env:` value matching `/(KEY|TOKEN|SECRET)/` name patterns — prevents regression if a future edit adds `env: { GEMINI_API_KEY: ... }`.

---

## 7. Expected post-remediation dump contents

After 6.1–6.2 + live cutover, each dumped app's env should contain only: `NODE_ENV`, `HYDI_DELEGATE_RECOVERY`, the app's interval/timeout vars, `PM2_*` internals, and filtered system vars (Path, SystemRoot, TEMP, etc.). **Zero entries matching `KEY|TOKEN|SECRET|SUPABASE|OPENAI|GEMINI|ANTHROPIC|STRIPE|VAPID|WHSEC`.**

---

## 8. `LIVE_SECURITY_ACTION_REQUIRED`

All actions below require live authorization. None were performed by this agent. Per `SECURITY_PROTOCOL.md`: never echo values; pipe/inject only; verify presence, not content.

### 8.1 Pre-flight verification (no downtime)

| Field | Detail |
|---|---|
| Exact action | 1) Validate `.env.local`'s `SUPABASE_SERVICE_ROLE_KEY` works against `http://127.0.0.1:54321` (run `node scripts/check-supabase-service.js` or a one-off `createClient` ping **with ambient env cleared in that shell**: `pwsh -NoProfile -Command "Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY,Env:SUPABASE_KEY,Env:SUPABASE_URL; node scripts/check-supabase-service.js"` — dotenv then supplies `.env.local` values). 2) Check whether `GEMINI_API_KEY` is a live key (one bounded metadata call or Google AI Studio console — never print it). 3) Identify `MY_SECRET_TOKEN`'s issuer (grep other project dirs / ask owner). |
| Services/processes | None touched |
| Reason | Confirms `.env.local` is a complete substitute before the ambient env is stripped — prevents a broken cutover |
| Expected downtime | None |
| Data risk | None (read-only checks) |
| Rollback | n/a |
| Preconditions | This plan reviewed; owner confirms which non-HYDI tools rely on `GEMINI_API_KEY`/`MY_SECRET_TOKEN`/etc. in user env |
| Postconditions | Confirmed list: which env vars are safe to remove; which keys need rotation |
| Verification | Check-script exits 0 using `.env.local` only |

### 8.2 Rotate suspect credentials

| Field | Detail |
|---|---|
| Exact action | Rotate `GEMINI_API_KEY` at Google AI Studio **if** live: create replacement → write into `.env.local` (and DPAPI store once 6.4 lands) → revoke old. Rotate `MY_SECRET_TOKEN` at its issuer if real. If `.env.bak-*`'s hosted Supabase project is still live, rotate that service-role key at Supabase dashboard too. |
| Services/processes | Rezonate generation path (`rezonate/generate.py`), `HybridModelStack`, `local-model-adapter`; issuer-side for `MY_SECRET_TOKEN` |
| Reason | Both persisted in plaintext at 3+ on-disk locations for months; must assume exposed |
| Expected downtime | Rezonate generation unavailable between revoke and redeploy (minutes); no impact on core HYDI pipeline |
| Data risk | None to data; an in-flight song generation could fail once |
| Rollback | Re-issue/re-enable old key at provider until new one propagates |
| Preconditions | 8.1 confirms which keys are real; new `.env.local` entries in place |
| Postconditions | Old values invalid everywhere — the leaked copies in `dump.pm2`/`.bak`/registry become dead strings |
| Verification | Provider-side revocation confirmation; one test call with the new key; confirm apps work |

### 8.3 Strip secrets from the Windows user environment

| Field | Detail |
|---|---|
| Exact action | For each var: `[Environment]::SetEnvironmentVariable('<NAME>', $null, 'User')` on: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `GEMINI_API_KEY`, `MY_SECRET_TOKEN`, `OPENAI_API_KEY`, `NOTION_TOKEN`, `GOOGLE_API_KEY`, `MINIMAX_API_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY` (owner's call), plus optional config vars `URSULA_URL`, `HEIDI_TOOL_MODEL`, `CHAT_PUSH_NOTIFICATIONS`, `SUPABASE_URL`. Ensure `.env.local` already contains every var the system needs **before** removal (diff the name lists — `.env.local` currently lacks `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `HEIDI_TOOL_MODEL`, `URSULA_URL`, `SUPABASE_KEY` alias — add non-secret ones / rotated ones first). |
| Services/processes | All user-session processes; PM2 daemon env on next restart |
| Reason | Removes the root plaintext store feeding the dump; stops silent inheritance into every spawned tool |
| Expected downtime | None directly; takes effect for **new** processes/logons (PM2 apps keep old env until restarted in 8.4) |
| Data risk | If a needed var is missed, the next boot fails preflight — mitigated by the name-diff and 8.1 verification |
| Rollback | Re-set any var via `SetEnvironmentVariable(name, <value>, 'User')` — keep a temporary DPAPI-encrypted backup of the name→value map until 8.4 verifies clean, then destroy it |
| Preconditions | 8.1 + 8.2 done; `.env.local` complete |
| Postconditions | `HKCU:\Environment` contains no secret-shaped names |
| Verification | `(Get-Item HKCU:\Environment).GetValueNames()` shows no `*KEY*`/`*TOKEN*`/`*SECRET*`/`SUPABASE*` entries |

### 8.4 Apply sanitized ecosystem config, restart PM2, regenerate dump

| Field | Detail |
|---|---|
| Exact action | 1) Deploy code changes 6.1 + 6.2. 2) `pm2 delete all` (or `node scripts/pm2-restart.js all`). 3) `pm2 start ecosystem.config.js` **from a sanitized shell** (new logon or `pwsh -NoProfile` after 8.3). 4) Wait for `hydi-boot` health gate (protoforge-core :3005, heidi-web :3000). 5) `pm2 save`. 6) `pm2 resurrect`-equivalent check: confirm `dump.pm2` rewritten. 7) Secure-delete `dump.pm2.bak` and any `dump.pm2` backup copies (e.g. `cipher /w` after delete, or move to encrypted store first if rollback retention is required). |
| Services/processes | All 8 PM2 apps: `hydi-boot` (protoforge-core, heidi-web, heidi-mobile-chat, job-executor-poller children), `hydi-watchdog`, `hydi-daemon`, `hydi-system-health`, `hydi-protoforge-scout`, `hydi-stuck-job-scheduler`, `hydi-revenue-reconciliation`, `hydi-failed-webhook-retry` |
| Reason | Only delete+start applies `filter_env`; `pm2 save` persists the clean env table; old dump/.bak copies are the leaked artifact |
| Expected downtime | Full stack restart ≈ 1–3 min (boot-agent health gates; `hydi-daemon` kill_timeout up to 50 s; `min_uptime`/`restart_delay` add margin). Schedulers resume on their intervals |
| Data risk | Low. An in-flight cognitive cycle may abort mid-run; job/queue state lives in Supabase (external to processes). `heidi-web` dev-server users see a brief outage |
| Rollback | Restore prior `ecosystem.config.js` + `scripts/*` from git; if dump backup was retained encrypted, `pm2 resurrect` from it (re-exposes secrets — last resort); otherwise re-add user env vars temporarily and restart |
| Preconditions | 8.1–8.3 complete; `.env.local` verified; git commit of code changes so rollback is clean |
| Postconditions | `dump.pm2` contains zero secret-shaped env keys; `.bak` gone; apps healthy |
| Verification | 1) `pm2 ls` all online. 2) `curl http://127.0.0.1:3005/health` + `:3000/api/health` OK. 3) Re-run the fingerprint scan (no value printing): assert no dump env key matches `/KEY|TOKEN|SECRET|SUPABASE|OPENAI|GEMINI|STRIPE|VAPID|WHSEC/`. 4) `pm2 describe hydi-stuck-job-scheduler` shows it found `SUPABASE_SERVICE_ROLE_KEY` (via dotenv — check its out-log for the "required" error being absent). 5) Log off/on or trigger `PM2Resurrect` to prove the sanitized dump resurrects correctly |

### 8.5 Hygiene cleanup

| Field | Detail |
|---|---|
| Exact action | Delete `tmp-secret-test.txt` (contains a live `whsec_` token), `.env.bak-akbnfovjdcobifeupvbn`, `.env.local.cloud-backup` after confirming contents are preserved in `.env.local`/DPAPI store; fix `.env.example`'s ambiguous `OPENAI_API_KEY` (rotate + history-scrub if real, else rewrite to obvious placeholder); purge `dump.pm2.bak` (part of 8.4 step 7) |
| Services/processes | None |
| Reason | Removes residual plaintext copies; the `.bak` hosted-Supabase JWT is the highest-residual-risk artifact |
| Expected downtime | None |
| Data risk | Deleting a backup that held the only copy of a still-needed value — mitigate by diffing var names against `.env.local` first |
| Rollback | Files are regenerable from their sources (Stripe dashboard, Supabase dashboard) |
| Preconditions | 8.4 verified green |
| Postconditions | Repo root contains no stray secret-bearing files |
| Verification | Fingerprint scan across repo root + `logs/` returns clean; `git ls-files` shows no tracked secret files |

### 8.6 Optional hardening

| Field | Detail |
|---|---|
| Exact action | `pm2 set pm2:discreet_mode true`; implement DPAPI store (6.4); add the CI guard test (6.5); restrict NTFS ACLs on `.env.local`/`.pm2/` to `Owner` only; exclude `.pm2` and the repo from consumer backup/sync tools that ship plaintext off-box |
| Services/processes | PM2 daemon config |
| Reason | Defense in depth against the next env-snapshot surface |
| Expected downtime | None |
| Data risk | Over-tight ACLs could break the PM2Resurrect task if it runs under a different context — verify task runs as `Owner` (it does: logon trigger, user session) |
| Rollback | `pm2 set pm2:discreet_mode false`; revert ACLs |
| Preconditions | 8.4 green |
| Postconditions | Reduced standing exposure |
| Verification | `pm2 get pm2:discreet_mode`; ACL review; resurrect test at next logon |

---

## 9. Decision checklist for the owner

1. Keep `ANTHROPIC_API_KEY` (and any CLI-tool keys) in user env as accepted risk, or move everything to `.env.local`/DPAPI? (Recommendation: move HYDI-consumed vars out; leave CLI-only vars per owner preference.)
2. Is `.env.bak-*`'s hosted Supabase project still live? If yes → rotate that service-role key now.
3. `MY_SECRET_TOKEN` — which tool owns it?
4. `.env.example` `OPENAI_API_KEY` — real or fake? Decide rotate+scrub vs. obvious-placeholder rewrite.
