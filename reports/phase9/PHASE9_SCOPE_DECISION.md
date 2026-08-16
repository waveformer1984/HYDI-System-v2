# Phase 9 Scope Decision

## Current verified baseline

* Phase 15: `a96d64f` `GO` — local-first, packet-level, worker queue
* Photo Forge Phase 5: `8f7ffcc` `GO WITH LIMITATIONS`
* Security logging: `753b3f0` — secret-rotation logging fixed
* Phase 7: `8ec4d61` `GO WITH LIMITATIONS` — Heidi semantic grounding with `local-mock`

HEAD now: `8ec4d61` on `release/v0.9.0`.

## Candidate capabilities

| Candidate | Current maturity | User/technical value | Evidence gap | Why Phase 9 |
|---|---|---|---|---|
| **A. Security and configuration hardening (CORS + prompt-injection guard)** | PARTIAL | High — CORS `*` exposes checkout/status endpoints; no prompt sanitization before LLM calls | `api/checkout.js`, `api/dashboard-status.js`, `api/ursula/status.js` hardcode `'*'`; `lib/ModelManager.ts` sends user prompts to Ollama/Anthropic without guard | Closes P1/P3 release blockers; low effort; no external dependencies; materially improves security boundary |
| **B. Worker queue live probe** | STUB | Medium — real-time queue depth needed for ops | `LocalHealthProbes.workers()` is a placeholder per `HYDI_TRUE_RELEASE_BLOCKERS.md` | Improves observability but is not a P1 release blocker |
| **C. Live dashboard polling** | NOT IMPLEMENTED | Medium — `dashboard/heidi-control-plane.html` is static | No live API polling implementation | Non-blocking; large UI surface if done right |
| **D. Photo Forge image data transformation** | NOT IMPLEMENTED | High — moves Photo Forge from state shell to real editor | No canvas, upload, or pixel processing | High effort; explicitly warned against automatically selecting in Phase 9 instructions |
| **E. Supabase Edge Functions runtime verification** | NOT VERIFIED | High — 42 Edge Functions not exercised | `supabase functions serve` not invoked | Certification/verification, not a capability increase; belongs to broader qualification |
| **F. Packet-level network re-verification (Phase 6)** | HISTORICAL | High for local-first claim | Phase 15 pcap is historical | Certification refresh, not a new capability; instructions explicitly keep Phase 6 separate |

## Selection

**Primary Phase 9 capability: A — Security and configuration hardening (CORS + prompt-injection guard).**

### Why it is higher priority than alternatives

* It is the last remaining P1-class security gap that can be closed without infrastructure or long-duration testing.
* Secret-value logging was already fixed in `753b3f0`; CORS and prompt-injection are the next concrete security blockers from the audit.
* It does not require cloud credentials, 24-hour soak, or clean-VM qualification.
* It is narrowly scoped, deterministic, and testable.
* It materially increases the security boundary of the production runtime.

### What is already proven

* `npm run build`, `npm start`, `npm test`, and `npm run typecheck` all pass.
* HMAC service/device token auth and RBAC are unit-tested.
* The secret-rotation logging bug is fixed.
* `api/checkout.js`, `api/dashboard-status.js`, and `api/ursula/status.js` work functionally.
* The chat pipeline (`POST /api/chat`) works with `local-mock` and Ollama.

### What is still missing

* Configurable, non-wildcard CORS for `api/checkout.js`, `api/dashboard-status.js`, and `api/ursula/status.js`.
* A prompt-injection/escape guard before any LLM call in `lib/ModelManager.ts`.
* Tests proving CORS rejects unexpected origins and prompt guard rejects suspicious input.

### What success means

1. CORS for the three endpoints is configurable via `process.env.MOBILE_CHAT_ORIGIN` and defaults to `localhost:3000` in development.
2. `OPTIONS` preflight and actual requests from a disallowed origin are blocked.
3. A prompt-injection guard rejects or escapes known injection patterns before the LLM is called.
4. Existing regression (typecheck, build, test suite) remains green.
5. Runtime verification under `npm start` shows correct CORS behavior.

### What is explicitly out of scope

* Credential rotation for `KEEPER_BREAK_GLASS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_ANON_KEY`.
* 24-hour soak, clean-VM qualification, or packet capture (Phase 10/Phase 6).
* Photo Forge canvas/image transformation.
* Ursula JWT Bearer migration.
* Supabase Edge Functions runtime verification.
* Worker queue live probe.
* Live dashboard polling.

## Decision

Implement a focused, testable security hardening capability: configurable CORS origin and an LLM prompt-injection guard. This is the highest-value unresolved capability that can be completed and qualified within Phase 9 without dependency on Phase 6 or Phase 10.
