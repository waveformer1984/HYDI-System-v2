# HYDI System Capability Matrix

Date: 2026-08-14
Repo: `C:\Users\Owner\HYDI-System-v2`
Branch: `feat/hydi-system-wide-audit`

## Legend

- **VERIFIED** — exercised and passing real tests/run
- **FUNCTIONAL** — implemented, should work, but not fully verified under load
- **PARTIAL** — some paths work, others missing or untested
- **SCAFFOLD** — skeleton present, not operational
- **PLANNED** — no implementation
- **DEGRADED** — works but with known failures/limitations
- **BLOCKED** — cannot operate due to missing dependency or critical bug
- **DEPRECATED** — retained for compatibility, not the future path
- **UNKNOWN** — not inspected or no executable evidence

## Capability Inventory

| System | Capability | Owning Path | State | Evidence | Local? | External Dep | Heidi Operable? | Auth Required | Human Auth? | Failure Behavior | Known Blockers |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **HEIDI** | Executive event processing | `pao-system/core/heidi.controller.ts` | SCAFFOLD | `HeidiController` implemented but never instantiated; `tests/unit/base-agent.test.ts`, `tests/unit/task-router.test.ts` pass | Yes | None | No (not constructed) | None in PAO | N/A | In-memory EventBus, 10k cap | Not wired to runtime; no RBAC integration |
| **HEIDI** | Operational control plane | `src/heidi-executive/` | FUNCTIONAL | `control-plane.test.js` 26/26 pass; but never run against a real stopped service | Yes | None | No (not invoked) | Service token (for chat only) | Yes, via `ApprovalManager` | Audit log, policy reject | Dormant; no runtime trigger |
| **HEIDI** | Chat routing | `api/chat/route.js` | FUNCTIONAL | `tests/unit/chat-route-rezonate.test.js` 6/6 pass; 7 handlers, some legacy stubs | Yes | None for chat | Yes (keyword dispatch) | `verifyServiceToken` HMAC | No | 401/400/200 | legacy CASCADE/KILO/ProtoForge handlers are stubs; no RBAC |
| **HEIDI** | Local model inference | `api/local-model.js`, `heidi-core/brain/ollama-client.js` | FUNCTIONAL | Unit tests pass with mocks; Ollama not running now | Yes | Ollama localhost | Yes, via chat | Some routes rate-limited only | No | Cloud fallback if keys set; canned fallback if no local + no key | Ollama not running in this environment |
| **URSULA** | System status endpoint | `api/ursula/status.js` | DEGRADED | Depends on Supabase `system_dashboard`; Rezonate now local | No | Supabase `system_dashboard` | Yes (read) | `verifyServiceToken` (not RBAC) | No | 503 if Supabase missing | Cloud view required for core status |
| **URSULA** | Health endpoint | `api/health.js` | DEGRADED | Public, no auth; depends on `system_dashboard` | No | Supabase | Yes (read) | None | No | 503 if view missing | No authentication, cloud-dependent |
| **CASCADE** | Canonical event classification | `protoforge/cascade/src/index.js` | FUNCTIONAL | Module initializes; `LedgerAdapter` requires Supabase | No | Supabase RAW LEDGER | No (not wired to Heidi) | None | No | Throws if Supabase missing | P0 cloud dependency |
| **CASCADE** | Legacy event classification | `modules/cascade-core.js` | DEPRECATED | `@deprecated` comment; stub in `api/chat/route.js` | Yes | None | No (stub) | None | No | Returns stub text | Replaced by canonical; not removed |
| **KILO** | Hypothesis generation | `kilo/index.js` | VERIFIED | `tests/unit/kilo-engine.test.js` passes; `execute()` throws by design | Yes | None | No (called as lib? not wired) | None | N/A | Throws on execution, safe outputs | Not connected to runtime decision loop |
| **KILO** | Execution guard | `kilo/index.js` | VERIFIED | Test confirms `execute()` throws unconditionally | Yes | None | N/A | N/A | N/A | Throws | N/A |
| **PROTOFORGE** | Policy engine | `lib/protoforge/policy-engine.js` | FUNCTIONAL | `tests/unit/protoforge-policy-engine.test.js` passes; fail-closed default | No | Supabase `policies`, `decisions` | No (library only) | None at runtime | Yes (escalate queue) | Reject if no active policy | Requires Supabase for rules |
| **HYVE** | Opportunity detection | `hyve_service/listener.py` | SCAFFOLD | No tests; polls filesystem | Yes | None | No | None | No | File-based, no error handling | Not wired to HYDI runtime; no tests |
| **REZONATE** | Canonical API | `protoforge-applications/rezonate/src/api/router.js` | VERIFIED | 128/128 `node --test` pass in this run | Yes (default memory/JSON) | Optional Supabase (2/7 tables) | Yes (via chat/PAO matrix) | `rezonate:manage` | No for read, yes for mutate | 401/403, real errors preserved | SupabaseStore 5-table gap; `user_id` not set on create |
| **REZONATE** | Project/track CRUD | `protoforge-applications/rezonate/src/repository.js` | VERIFIED | Tested via canonical API | Yes | Optional | Yes | `rezonate:manage` | Yes for write | NotFound/Validation errors | See above |
| **REZONATE** | AI song generation | `protoforge-applications/rezonate/src/adapters/resonate-engine.js` | FUNCTIONAL | Code inspected; requires `GEMINI_API_KEY` | Yes | Optional Gemini | No | `rezonate:manage` | No | Fails with missing key | Cloud API if used; not local Ollama |
| **REZONATE** | Stem separation | `rezonate/make-stems.py` | VERIFIED | Real WAV output tested | Yes | Local Python/librosa | Yes | `rezonate:manage` | No | Error if source missing | Works locally |
| **REZONATE** | Sample library | `protoforge-applications/rezonate/src/adapters/sample-library.js` | VERIFIED | 31,148 catalog entries; tests pass | Yes | Local catalog | Yes | `rezonate:manage` | No | Returns empty if catalog missing | Works locally |
| **REZONATE** | Studio mixing | N/A | PLANNED | No code | Yes | N/A | No | N/A | N/A | N/A | N/A |
| **REZONATE** | NFT/Blockchain | N/A | PLANNED | No code | Yes | N/A | No | N/A | N/A | N/A | N/A |
| **AI** | Ollama runtime | `src/hydi-v3/OllamaAdapter.js` | PARTIAL | Code present; `pgrep` shows Ollama not running | Yes | Ollama localhost | No (not wired to HYDI actions) | None | No | Returns `available: false` | Ollama not running; no model guarantee |
| **AI** | Local embeddings | `tests/unit/embeddings.test.ts` | FUNCTIONAL | Tests pass; zero-pads Ollama 768-dim to 1536 | Yes | Ollama | No | None | No | Falls back to OpenAI if key set | Depends on Ollama reachability |
| **AI** | Claude/OpenAI fallback | `lib/claude.ts`, `lib/ModelManager.ts` | FUNCTIONAL | Code wired; no keys in env now | No | Anthropic/OpenAI | No | None | No | Throws if no key | Cloud fallback if keys present |
| **PERSISTENCE** | Local SQLite memory | `heidi-core/memory/sqlite-store.js`, `modules/state-manager.js` | FUNCTIONAL | Falls back to in-memory with warning; tests exist | Yes | sqlite3 optional | N/A | N/A | N/A | In-memory if sqlite3 missing | Data loss on restart in fallback |
| **PERSISTENCE** | Local JSON store | `protoforge-applications/rezonate/src/persistence/json-store.js`, `switchboard/src/persistence/` | VERIFIED | Tested; backup support in switchboard | Yes | None | N/A | N/A | N/A | File I/O errors | Works without cloud |
| **PERSISTENCE** | Cloud Supabase schema | `supabase/migrations/` | FUNCTIONAL | 70+ migrations, each has a test | No | Supabase project | N/A | Service role key | N/A | Connection errors | Cloud-only; schema gaps for Rezonate |
| **PERSISTENCE** | Worker orchestration | `workers/WorkerOrchestrator.js` | BLOCKED | Throws if Supabase missing | No | Supabase | N/A | Service role key | N/A | Startup crash | P0 cloud blocker for workers |
| **DASHBOARD** | System dashboard view | `api/health.js`, `api/ursula/status.js` | DEGRADED | Uses `system_dashboard` Supabase view | No | Supabase | Yes (read) | None / service token | No | 503 if view missing | Cloud-only; no local fallback |
| **DASHBOARD** | Mobile status | `api/mobile-status.js` | DEGRADED | Single round-trip contract; depends on Supabase views | No | Supabase | Yes | `status:view` | No | 503 if missing | Cloud-only |
| **STRIPE** | Checkout | `api/checkout.js` | FUNCTIONAL | Tests pass with mocks | No | Stripe API | No | Rate-limited only | Yes (money) | Error if key missing | No test/live mode guard |
| **STRIPE** | Connect webhooks | `api/stripe-connect-webhook.js`, `api/webhooks/stripe.js` | FUNCTIONAL | HMAC + idempotency + kill switch; tests pass | No | Stripe + Supabase RPC | No | HMAC only | Yes (money) | 500 if secret missing | No test/live mode guard; real money risk |
| **STRIPE** | Revenue engine | `revenue-engine/index.js`, `revenue-engine-v2.js`, `src/revenue/HeidiRevenueEngine.js` | PARTIAL | Three overlapping implementations; tests for some routes | No | Stripe + Supabase | No | `revenue:view/manage` | Yes (money) | Varies by route | Duplicated logic, no canonical owner |
| **SECURITY** | RBAC | `lib/auth/rbac.js` | VERIFIED | `tests/unit/rbac.test.js` passes | Yes | None | N/A | N/A | N/A | Fail-closed | Not enforced on all routes |
| **SECURITY** | Service token | `lib/auth/verifyServiceToken.js` | VERIFIED | `tests/unit/auth.test.js` passes; HMAC-SHA256, timingSafeEqual | Yes | None | N/A | `HYDI_SERVICE_SECRET` | N/A | 401 with reason | Some routes do not use it |
| **SECURITY** | Auth audit log | `lib/auth/requireAuth.js` | FUNCTIONAL | Writes `auth_audit_log` | No | Supabase | N/A | N/A | N/A | Swallows audit errors | Depends on Supabase |
| **SECURITY** | Unauthenticated sensitive endpoints | `api/health.js`, `api/traces.js`, `api/revenue.js`, `api/client-dashboard.js` | BLOCKED | No `requireAuth` on these paths | Yes | None | N/A | N/A | N/A | Public access | Security blocker for production |
| **DEPLOYMENT** | Next.js build | `next.config.js`, `package.json` | VERIFIED | `npm run build` completed successfully this session | Yes | None | N/A | N/A | N/A | Build warnings (pre-existing) | Warnings only |
| **DEPLOYMENT** | Local Next.js dev | `npm run dev` | FUNCTIONAL | `CLAUDE.md` documents; `HYDI_System` next process seen on port 3001 | Yes | None | N/A | N/A | N/A | N/A | V2 not currently running |
| **DEPLOYMENT** | CI/CD | `.github/workflows/` | DEGRADED | Workflows defined; GitHub runners reported as blocked | No | GitHub | N/A | N/A | N/A | N/A | Local pre-push hook is primary gate |
| **DEPLOYMENT** | PM2 managed processes | `ecosystem.config.js` | PARTIAL | Config lists 8+ processes; cannot confirm all running | Yes | None | N/A | N/A | N/A | N/A | One `next` process seen for HYDI_System, not v2 |
