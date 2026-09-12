# HYDI System v2 — Code Audit Report

**Date:** September 7, 2026
**Branch audited:** `feat/governed-autonomy` @ `b3c2fba`
**Auditor:** Claude, working directly in the repo over this session

## Methodology and honest limits

This audit combines three things: automated tooling run against the real repo (typecheck, lint, the full Jest suite, `npm audit`, the built-in security-audit script), targeted pattern searches across all ~4,700 git-tracked files for known risk classes, and everything learned by hand while live-debugging this system earlier in the same session (two real production bugs found and fixed by direct investigation, not by scanning).

Two limits worth stating plainly. First, this sandbox has no route to your machine's local Supabase/Postgres (`127.0.0.1:54322`) or to any live daemon process, so every test that depends on those fails here with `ECONNREFUSED` or an availability check — that's an environment gap, not a code defect, and it's called out explicitly wherever it applies. Second, the Jest suite has 341 test files and this sandbox's per-command budget didn't allow a single unbroken full run; I sharded it and completed 2 of 6 shards (~114 files) to completion, which is enough to establish a pattern with confidence but is not a claim that all 341 files were individually inspected. A full run belongs on your machine, where Postgres is actually reachable.

## Executive summary

The code itself is in decent shape: TypeScript strict mode passes clean across the whole repo, ESLint finds only 7 trivial style errors (all in test files) against 1,346 mostly-cosmetic unused-variable warnings, and `npm audit` found zero critical vulnerabilities. The real story of this audit isn't line-level bugs — it's structural. This repository contains at least three to four separate, undocumented, coexisting implementations of overlapping concepts (a shadow `heidi-core/` project, a shadow `protoforge/` project, an unrelated `switchboard/` side-project, and a newer `src/hydi-v3/` layer that duplicates classes also defined in `lib/` and `pao-system/`). That sprawl isn't hypothetical risk — it's the confirmed root cause of two real bugs already found and fixed this session, including the one that was making `/api/chat` take 46–80 seconds and fail outright.

## 1. Headline finding: architectural sprawl is the dominant risk

`git ls-files` shows 4,691 tracked files. Stripping out the ~1,600 markdown files and dozens of near-identical AI-coding-tool config directories (`.windsurf`, `.trae`, `.roo`, `.qwen`, `.pochi`, etc. — 38 files each, clearly boilerplate, not product code) still leaves a genuinely large surface. Inside that surface are several complete, independent sub-projects that CLAUDE.md's architecture section either doesn't mention or mentions only in passing:

| Directory | Files | What it actually is |
|---|---|---|
| `heidi-core/` | 104 | A **separate npm project** (own `package.json`, own `server.js`, own SQLite-backed memory, own CASCADE/reflection/self-awareness modules) that runs on port 3459. It ships **12 different PowerShell start scripts** (`Start-Heidi.ps1`, `Start-Heidi-Alt.ps1`, `-Clean`, `-Final`, `-Fixed`, `-Robust`, `-Working`, plus matching `Test-Heidi-*.ps1` variants) and **4 alternate JS entry points** (`index-clean.js`, `index-clean-alt.js`, `index-clean-3458.js`, `launch-verified.js`). None of today's fixes touched this directory. |
| `protoforge/` | 132 | A separate tree with its own `blueprints/`, `cascade/`, `hydi-gateway/` (its own npm package, `hydi-event-gateway`), `packages/`, `tools/` — distinct from the documented `lib/protoforge/` policy engine and from `src/server.js`'s "ProtoForge Core." |
| `protoforge-applications/` | 84 | `proto-yi` and `rezonate` sub-apps — a second, separate Rezonate implementation alongside whatever `ursula-suite/rezonette` and the desktop `Rezonate_Core` app are. |
| `switchboard/` | 53 | A **completely unrelated side project** — its own `package.json` literally describes it as "Local-first gig-matching MVP for performers and venues." Has nothing to do with HYDI and is vendored inside this repo regardless. |
| `apps/ursula-frontend/` | 462 | A large separate frontend, only referenced in passing in CLAUDE.md (lint scope, one archived `vercel.json`). |

None of these bind to the canonical ports (3000/3005/3006) as far as I could find by pattern search, so they won't fight the real system for a TCP port. But they absolutely can run independently, unsupervised by `npm run boot`, and — critically — **they don't receive fixes made to the canonical `src/`/`lib/` code**, because they're separate files. During this session I watched exactly this happen live: a terminal window was running a process emitting the *pre-fix* symptoms (missing model configs, 8000ms hardcoded timeouts, "insufficient data" feedback-loop bug) well after those exact bugs had already been fixed and verified in the canonical boot. The most likely explanation is that something — plausibly another agent running in the environment — launched one of these parallel implementations instead of `npm run boot`, and there is currently nothing in the repo that would stop that from happening again or make it obvious when it does.

**Beyond the shadow directories**, the same failure mode shows up as duplicate class names *within* the parts of the codebase that are supposed to be canonical:

| Class name | File A | File B |
|---|---|---|
| `HeidiOrchestrator` | `src/orchestrator/HeidiOrchestrator.js` | `lib/orchestrator.ts` |
| `ModelManager` | `lib/ModelManager.ts` | `src/hydi-v3/ModelManager.js` |
| `EventBus` | `lib/event-bus/EventBus.ts` | `pao-system/core/event.bus.ts` |
| `AgentRegistry` | `lib/agents/registry.ts` | `pao-system/core/agent.registry.ts` |
| `BaseAgent` | `pao-system/agents/base.agent.ts` | `src/hydi-v3/BaseAgent.js` |
| `CapabilityRegistry` | `lib/heidi/CapabilityRegistry.ts` | `src/hydi-v3/CapabilityRegistry.js` |
| `DevelopmentAdapter` | `lib/human-action/adapters/DevelopmentAdapter.ts` | `src/hydi-v3/CapabilityAdapters.js` |
| `FinanceAgent` | `pao-system/agents/business/finance.agent.ts` | `src/hydi-v3/FinanceAgent.js` |
| `ReplayEngine` | `lib/replay-engine.ts` | `lib/protoforge/replay-engine.ts` |
| `NotificationService` | `pao-system/services/notification.service.ts` | `pao-system/services/nnotification.service.ts` |

The `HeidiOrchestrator` pair is the one already documented (with header comments added this session explaining the split). The `nnotification.service.ts` pair is also already documented in CLAUDE.md as a known typo, kept intentionally. The other eight are **not documented anywhere** and each one is a candidate for the exact class of bug fixed twice this session already (see below): two files quietly resolve the same concept differently, nothing enforces that they agree, and whichever one happens to get imported wins — silently.

**Recommendation:** this is worth a dedicated cleanup pass, not a line-item fix. Concretely: (1) decide which of `heidi-core/`, `protoforge/`, `protoforge-applications/`, `switchboard/` are still meant to be live vs. archived, and either move the dead ones into `archive/` (which this repo already uses for exactly this purpose, cleanly, for eight other retired implementations) or add a README at each root stating clearly what it is and whether it's canonical; (2) for the ten duplicate class names, add the same kind of disambiguating header comment already added to `HeidiOrchestrator` and `lib/orchestrator.ts` this session, or better, rename one side of each pair so an import typo can't silently resolve to the wrong implementation.

## 2. Bugs found and fixed this session (for context)

These were found by direct, hands-on debugging of the live system, not by static scanning — included here because they're the concrete evidence behind the sprawl finding above, and because a few earlier ones share a root cause worth generalizing from.

| Commit | Fix |
|---|---|
| `7a756dd` | Route llama-type models through Ollama instead of a never-shipped `./bin/main` binary (100% revenue-loop failure); stop `rotate-secrets.js` from logging secrets |
| `034b9af` | Wire core-loop task outcomes into `HeidiControlPlane`'s learning history (was permanently stuck on "insufficient data") |
| `8708771` | Fix adaptation targeting `"unknown"` instead of real model names |
| `344c5d3` | Fix `"Learning recorded: undefined"` — feedback packet field names didn't match what the logger read; also began the `HeidiOrchestrator` instance-unification work |
| `6071106` | Fix heartbeat health checks for aliased service→model names (`document-summarizer`, `sentiment-analyzer` etc. had "no configuration found") |
| `c3ea7dc` | Reconcile model timeout/degraded thresholds with this Ollama deployment's single-concurrency-slot reality; added client-side request serialization |
| `1b739d6` | `.gitattributes` line-ending normalization |
| `dfdf173` | Photo Forge dashboard scaffold |
| `8f5cfff` | Documented the `HeidiOrchestrator` naming collision (see §1) |
| `dd0b401` | **Wired `JobExecutor.processNextJob()` into the live boot sequence.** Nothing was ever calling it — real, webhook-confirmed, paid customer jobs were reaching `queued` status and then sitting there forever. On the first restart after this fix, the poller immediately drained an 18-job backlog (test-mode Stripe data, confirmed safe) that had been stuck for up to ~12 days. |
| `b3c2fba` | **Fixed the Ollama model mismatch that was causing `/api/chat` to take 46–80 seconds and fail.** `src/models/local-model-adapter.js`'s `runLlamaInference()` defaulted to the literal `'llama3'`, while the real chat backend (`lib/ModelManager.ts`) defaults to `'llama3.2:3b'` — two different models. This Ollama deployment holds only one loaded model at a time, and the heartbeat monitor calls ~13 aliases every ~30 seconds, all routed through the mismatched default — so heartbeat was constantly evicting whatever the chat path had warm. Confirmed by direct measurement: a cold load of `llama3.2:3b` alone took 37 seconds. |

The last two are the clearest examples of the sprawl pattern from §1: two files, each independently deciding "what's the real Ollama model" or "what advances a paid job," silently disagreeing, with nothing to catch the drift until a live symptom showed up. A follow-up grep (`process.env.OLLAMA_MODEL\|LOCAL_MODEL_NAME` across `src/` and `lib/`) confirms the fix now agrees with the other two places that resolve this same value (`lib/communication/channels/heidiCoreAdapter.ts`, `lib/heidi/CognitiveCoreBuilder.ts`) — so that specific piece of drift is fully closed, not just patched in one spot.

## 3. Automated quality gates

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, whole repo, strict mode) | **Clean. 0 errors.** |
| `npm run lint` | 7 errors, all `prefer-const` in test files (cosmetic); 1,346 warnings, overwhelmingly `no-unused-vars` in test files. No error-level findings in production code. |
| `npm run security-audit` (built-in script) | Passed, 0 findings — but its own output shows it only scans `src/hydi-v3/` and `src/HYDISystem.js`. It is not a whole-repo security tool; treat a clean run from it as narrow, not comprehensive. |
| `npm audit` | 9 vulnerabilities in 1,045 dependencies: **0 critical, 7 high, 1 moderate, 1 low.** See §5. |
| Jest suite (2 of 6 shards run to completion, ~114 of 341 files) | 8 failing files, **all 8 traced to the same root cause**: `connect ECONNREFUSED 127.0.0.1:54322` (no local Supabase reachable from this sandbox) or a live-daemon-availability check that can't succeed without one. Zero failures attributable to actual code defects in the files exercised. This needs a full run on your machine (where Postgres is real) for a final sign-off — see §6. |

## 4. Security posture

**Positives worth naming.** There's a real, dedicated secret-redaction system (`SECRET_PATTERNS` + `redactPayload()` in the adaptive-operator persistence layer, plus a separate `structured-logger` redaction path) that strips Stripe/AWS/JWT/private-key-shaped values before anything is written to Supabase — this is layered, not a single point of failure. There's also a `HistoricalSecretRemediationTracker` that scans git history for secret patterns and tracks rotation/revocation status per finding — more mature tooling here than most repos this size have. The live-Stripe guardrails (`ALLOW_LIVE_STRIPE`, `LiveTransactionAuthorization`'s reserve-then-consume pattern, the 410-Gone gate on the legacy checkout route in production) are well-designed and consistently applied everywhere I checked a webhook or checkout path.

**Findings:**

- **CORS wildcard is widespread.** At least 18 endpoints under `api/` and `pages/api/system/` set `Access-Control-Allow-Origin: *` — some unconditionally (`pages/api/system/health.ts`, `jobs.ts`, `metrics.ts`, `watchdog.ts`, `events.ts`; `api/checkout.js`, `api/client-dashboard.js`, `api/health.js`, `api/life-flow/route.js`), others as a fallback (`process.env.MOBILE_CHAT_ORIGIN || '*'`) that's still wide open whenever that env var is unset. Most of these use bearer-token/API-key auth rather than cookies, which limits classic CSRF risk, but the `pages/api/system/*` group returns internal health/job/metrics telemetry to any origin with no auth check visible at the CORS layer — worth tightening to an explicit allowlist even if the practical exposure today is low.
- **The auth layer is currently wide open by omission, by design of a fail-safe that isn't actually safe in this state.** Boot logs confirm: `[SIMPLE KEYMAKER] No STARTER_API_KEY/PRO_API_KEY/ENTERPRISE_API_KEY configured — every POST request will be rejected with 401 until at least one is set.` That's the *correct* fail-closed behavior for an unconfigured system, but it also means right now, with zero keys configured, every POST route behind SIMPLE KEYMAKER is unreachable — worth confirming that's intentional for the current deployment stage and not accidentally blocking something you think is live.
- **`exec()`/`execSync()` with template-literal command construction** appears in `lib/human-action/adapters/DevelopmentAdapter.ts` (git commit/push/test/build/deploy commands), `lib/human-action/adapters/InfrastructureAdapter.ts` (`` `docker ${args.join(' ')}` ``), and `lib/operational/CredentialSource.ts`. None of these showed obviously user-controlled input reaching the shell in the files I read, and CLAUDE.md's R1–R5 risk-tier model implies these sit behind human-authorization gates for anything above the lowest tier — but I didn't fully trace every call site's upstream data flow to confirm no unvalidated string can ever reach `args.join(' ')` or a template literal here. Worth a focused review given this is literally the layer that executes real actions on your behalf.
- **One `eval('require')(...)`** in `lib/human-action/adapters/BrowserAdapter.ts`, used to dynamically load `puppeteer-core`/`puppeteer` without webpack bundling them. The argument is a hardcoded string literal, not user input — low risk as written, but `eval` is the kind of pattern that tends to get flagged by every scanner going forward, so it's worth a comment explaining why it's there (or switching to a webpack `externals` config instead).

## 5. Dependency vulnerabilities (`npm audit`)

0 critical, 7 high, 1 moderate, 1 low — all have a fix available, most via a straight `npm audit fix`:

| Package | Severity | Issue | Fix |
|---|---|---|---|
| `@puppeteer/browsers` / `puppeteer-core` / `extract-zip` | High | Symlink path traversal in `extract-zip`; chained through puppeteer-core | Requires bumping `puppeteer-core` to 25.10.0 (semver-major) |
| `brace-expansion` | High | DoS via unbounded expansion / intermediate arrays | `npm audit fix` |
| `browserslist` | High | Unbounded memory growth; crash via untrusted stats file | `npm audit fix` |
| `js-yaml` | High | Quadratic CPU consumption in `!!omap` resolution | `npm audit fix` |
| `nanoid` | High | Infinite loop with `size: 0` in custom generators | `npm audit fix` |
| `qs` | Moderate | Array-limit bypass; DoS via `isBuffer` | `npm audit fix` |
| `postcss-selector-parser` | Low | DoS via uncontrolled AST recursion | `npm audit fix` |

All DoS-class, none RCE, none affecting the Stripe/Supabase/payment path directly (these are build-tooling and browser-automation dependencies). Run `npm audit fix` for the six auto-fixable ones; the puppeteer bump is a separate, deliberate decision since it's semver-major.

## 6. What still needs verifying on your machine

- A full, uninterrupted `npx jest --forceExit` run against your real local Supabase, to confirm the 8 failures seen here really are 100% environmental and not masking anything.
- Live confirmation that the Ollama model-mismatch fix (`b3c2fba`) actually drops chat latency after warm-up — last check-in was still mid-restart.
- A decision on what to do with `heidi-core/`, `protoforge/`, `protoforge-applications/`, and `switchboard/` — archive, document, or actively maintain.

## Appendix: repo composition

4,691 git-tracked files. By extension: 1,606 `.md`, 1,501 `.js`, 736 `.ts`, 194 `.sql`, 152 `.json`, 134 `.tsx`, 89 `.ps1`, plus smaller counts of `.py`, `.html`, `.sh`, `.jsx`. By top-level directory (largest first, excluding dotfiles/AI-tool-config boilerplate): `apps/` 462, `tests/` 371, `lib/` 269, `src/` 250, `scripts/` 163, `supabase/` 156, `protoforge/` 132, `archive/` 113, `pages/` 109, `heidi-core/` 104, `protoforge-applications/` 84, `docs/` 74, `reports/` 72, `modules/` 56, `switchboard/` 53, `pao-system/` 44. `api/` has 35 tracked files vs. `pages/api/`'s 92 — consistent with CLAUDE.md's documented pattern that `pages/api/*` is what's actually reachable and `api/*` is largely bridged-to or superseded. `supabase/functions/` has 48 tracked Edge Functions, matching the 42 "active" ones CLAUDE.md documents plus a handful of newer/retired ones.
