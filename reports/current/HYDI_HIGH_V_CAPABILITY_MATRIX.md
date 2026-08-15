# HYDI High-V Capability Matrix

## Legend

### Implementation status

* `COMPLETE` — fully implemented
* `PARTIAL` — partially implemented
* `STUB` — placeholder exists
* `MOCK` — mock implementation
* `PRESENTATION ONLY` — UI/code present, no real logic
* `NOT IMPLEMENTED` — does not exist
* `FAILED` — exists but is broken
* `UNKNOWN` — could not determine

### Verification

* `PASS` — verified at current runtime
* `PARTIAL` — partly verified
* `FAIL` — failed
* `NOT VERIFIED` — no runtime evidence
* `N/A` — not applicable

## Capability Matrix

| Capability | Location | Intended behavior | Implementation status | Automated tests | Runtime evidence | Security boundary | Local-first | Production verified | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Production build | `package.json` `build` / `prestart` | Create optimized `.next` production build | COMPLETE | unit/migration tests pass | `npm run build` PASS | N/A | N/A | YES — `npm start` rebuilt and served | PASS |
| Production runtime | `package.json` `start` | Serve production build on port 3000 | COMPLETE | `npm test` clean | `npm start` PASS (Phase 4/5) | N/A | N/A | YES | PASS |
| Type safety | `tsconfig.json`, `npm run typecheck` | TypeScript compilation | COMPLETE | `npm test` | `npm run typecheck` PASS | N/A | N/A | YES | PASS |
| Unit test suite | `tests/` | 262 test files, 2500+ tests | COMPLETE | 262 suites | `npm test` PASS | N/A | N/A | YES | PASS |
| Integration tests | `tests/integration/` | 12 files, 91 assertions | PARTIAL | 12 files present | require live Supabase, NOT VERIFIED in this session | N/A | N/A | NO | PARTIAL |
| Local-first boundary | `lib/ModelManager.ts`, `heidi-core/self-awareness/` | Prefer local; optional external | COMPLETE | Phase 15 tests | historical pcap (Phase 15) | N/A | YES | PARTIAL (historical) | PASS |
| Local AI (Ollama) | `lib/ModelManager.ts`, `api/local-model.js` | Local inference with fallback | COMPLETE | `tests/unit/heidi-chat-pipeline.test.js` | runtime `POST /api/chat` used `model_used: api` fallback when local fails | N/A | YES | PARTIAL | PARTIAL |
| Cloud AI fallback | `lib/ModelManager.ts` | Anthropic/OpenAI if valid keys | COMPLETE | key validation tests | not exercised with real keys | N/A | optional | NOT VERIFIED | PARTIAL |
| Heidi user chat | `pages/api/chat.ts` | Stream SSE for dashboard/Photo Forge | COMPLETE | `tests/unit/heidi-chat-sse.test.ts` | Phase 3/4/5 SSE | N/A | YES | YES | PASS |
| Multi-agent dispatcher | `api/chat/route.js` | HMAC-gated agent routing | COMPLETE | auth tests | no runtime in this session | HMAC service token | optional | NOT VERIFIED | PARTIAL |
| Photo Forge workspace | `pages/photo-forge.tsx` | State-managed workspace | COMPLETE | `tests/unit/photo-forge-capability.test.ts` | `GET /photo-forge` 200 | N/A | YES | YES | PASS |
| Photo Forge image data | `pages/photo-forge.tsx` | Real image upload/processing | NOT IMPLEMENTED | no tests | no actual image data | N/A | YES | NO | FAIL |
| Heidi context for Photo Forge | `lib/photo-forge-context.ts` | Prepend workspace state to message | COMPLETE | context tests | Phase 5 payloads differ | N/A | YES | YES | PASS |
| Worker queue | `workers/queue-system.sql`, `workers/QueueManager.js` | Postgres-backed task queue | COMPLETE | `tests/unit/worker-queue-live.test.js` | live Postgres verified | service role | YES | PARTIAL | PASS |
| Worker orchestration | `workers/WorkerOrchestrator.js` | Supervise 18 workers | COMPLETE | unit tests | not live in this session | service role | YES | NOT VERIFIED | PARTIAL |
| Health endpoints | `api/health.js`, `api/mobile-status.js`, `api/ursula/status.js`, `api/heartbeat.js` | Health/heartbeat/status | COMPLETE | unit tests | `GET /api/status` 200 | public for health | YES | YES | PASS |
| Auto-heal | `api/ursula/status.js` RPC | Trend-based auto recovery | COMPLETE | migration tests | not live in this session | N/A | YES | NOT VERIFIED | PARTIAL |
| Circuit breakers | `lib/ModelManager.ts`, `keeper/circuit/`, `modules/world-connectivity-manager.js` | Failure isolation | COMPLETE | unit tests | not live in this session | N/A | YES | NOT VERIFIED | PARTIAL |
| Degraded mode | `heidi-core/self-awareness/local-first-constraints.js` | Low-confidence fallback | COMPLETE | not found | not live in this session | N/A | YES | NOT VERIFIED | PARTIAL |
| Auth service tokens | `lib/auth/verifyServiceToken.js` | HMAC-SHA256 service tokens | COMPLETE | auth tests | no runtime in this session | HMAC | N/A | NOT VERIFIED | PASS (unit) |
| Auth device tokens | `lib/auth/deviceAuth.js` | Per-device HMAC | COMPLETE | auth tests | no runtime in this session | HMAC | N/A | NOT VERIFIED | PASS (unit) |
| RBAC | `lib/auth/rbac.js` | 42 permissions, 4 roles | COMPLETE | unit tests | no runtime in this session | fail-closed | N/A | PASS (unit) |
| Secret logging fix | `scripts/rotate-secrets.js` | Do not log new secrets | FAILED | no test found | N/A | N/A | N/A | NO | FAIL |
| CORS hardening | multiple `api/*.js` | Configurable CORS | PARTIAL | no dedicated tests | N/A | N/A | N/A | NO | PARTIAL |
| Prompt injection guard | `api/chat/route.js` | Sanitize before LLM | NOT IMPLEMENTED | no tests | N/A | N/A | N/A | NO | FAIL |
| SQL injection mitigation | migrations, Supabase client | Parameterized queries | COMPLETE | `SecurityAuditor.test.js` | N/A | N/A | N/A | PASS (unit) |
| Supabase local integration | `src/database.js`, `heidi-core/` | Local DB and auth | COMPLETE | many migration tests | `memory_connected: true` | service role | YES | PARTIAL | PASS |
| Memory/persistence | `memories` table, `lib/heidi-memory/` | Conversation memory | COMPLETE | `heidi-memory-system.test.js` | `memory_connected: true` | RLS | YES | PARTIAL | PASS |
| Operational qualification harness | `operational-qualification/` | 24h soak, failure injection | COMPLETE | `validation-tooling-integrity.test.js` | not executed for full 24h | N/A | N/A | NO | PARTIAL |
| Soak test | `scripts/soak-test.js` | Endurance/chaos | COMPLETE | no runtime in this session | no 24h run | N/A | YES | NOT VERIFIED | PARTIAL |
| Revenue engine | `revenue-engine/` | Billing/ledger logic | COMPLETE | unit tests | not live in this session | Stripe mock | optional | NOT VERIFIED | PARTIAL |
| Stripe Connect | `api/stripe/`, `api/checkout.js` | Payment/subaccount routing | PARTIAL | `tests/unit/stripe-connect-webhook.test.js` | not live in this session | HMAC/webhook | optional | NOT VERIFIED | PARTIAL |
| KILO hypothesis generation | `kilo/` | Generate hypotheses, no execute | COMPLETE | unit tests | not live | N/A | YES | NOT VERIFIED | PASS (unit) |
| ProtoForge policy engine | `lib/protoforge/policy-engine.js` | DSL policy gate | COMPLETE | unit tests | not live | N/A | YES | NOT VERIFIED | PASS (unit) |
| Event pipeline | `cascade/`, `kilo/`, `lib/protoforge/` | Six-layer pipeline | COMPLETE | unit tests | not live | N/A | YES | NOT VERIFIED | PARTIAL |
| Mobile ops | `api/mobile-status.js`, `lib/auth/` | 3G-safe status | COMPLETE | unit tests | no runtime in this session | device token | optional | NOT VERIFIED | PARTIAL |
| Agent manager | `pages/agent-manager.tsx`, `api/agent-manager/` | Worker control UI | COMPLETE | not verified | not live | RBAC | YES | NOT VERIFIED | PARTIAL |
| Song composer | `pages/song-composer.tsx` | Music composition UI | COMPLETE | not verified | not live | N/A | YES | NOT VERIFIED | PARTIAL |

## Maturity Levels

| Capability | Level |
|---|---|
| Production build/runtime | 4 |
| Local-first boundary | 5 |
| Heidi user chat transport | 5 |
| Worker queue | 4 |
| Auth HMAC/RBAC | 4 |
| Photo Forge image transformation | 1 |
| Heidi semantic correctness | 2 |
| Operational certification | 3 |
| Security hardening (CORS, secret logging) | 2 |
| Multi-agent dispatcher | 3 |
