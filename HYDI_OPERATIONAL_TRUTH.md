# HYDI operational truth

**As-of:** 2026-11-19T19:35:00Z  
**Git:** `clean-main` @ `06cf644d7325ac8b4488913253de54e02b57fb30`  
**Auditor:** Cursor Cloud agent (code + CI + local scripts only)

Legend: **OPERATIONAL** = verified behavior in this environment; **DEGRADED** = partial or dependency gap; **DISCONNECTED** = not wired; **MISSING** = not present in tree or deploy; **UNVERIFIED** = exists in repo/merge history but not runtime-proved here.

---

## Phase 0 — baseline

| Subsystem | State | Evidence | Host | Method |
|-----------|-------|----------|------|--------|
| Git `clean-main` | OPERATIONAL | `git rev-parse HEAD` = `06cf644d…` | Cloud VM | git |
| Working tree | OPERATIONAL | clean on audit checkout | Cloud VM | `git status` |
| Recent merges (voice, agent, mobile, embeddings) | OPERATIONAL | PRs #629,#628,#627,#625 merged 2026-11-19 | GitHub | `gh pr list` |
| Frank runtime | UNVERIFIED | No tailnet/SSH from cloud | — | blocked |
| Termux runtime | UNVERIFIED | No device access | — | blocked |
| Supabase DB | DISCONNECTED (audit VM) | `verify-supabase.sh` FATAL: missing `SUPABASE_URL` / service role | Cloud VM | script |
| Cloud LLM credentials | UNVERIFIED (presence) | `.env` absent on VM; gates exist in code | Cloud VM | file presence |

---

## Recent merged PRs (relevant)

| PR | Area | Merged (UTC) | Runtime on Frank? |
|----|------|--------------|-------------------|
| #629 | Voice `services/voice/`, `heidi_voice.py`, V3 voice adapters | 2026-11-19 | UNVERIFIED |
| #628 | Mobile chat inline approvals (client) | 2026-11-19 | UNVERIFIED |
| #627 | Heidi agent phase 2 (:3462, phone advisor) | 2026-11-19 | UNVERIFIED |
| #625 | Embeddings `vector(768)` + backfill script | 2026-11-19 | UNVERIFIED |
| #618 | Proof-of-value / baseline harness | 2026-11-16 | UNVERIFIED on Frank |

---

## Subsystem inventory

### Pipeline (six layers)

| Layer | State | Evidence |
|-------|-------|----------|
| Ingestion → Ledger → CASCADE → KILO → ProtoForge → Emission | OPERATIONAL (unit) | `tests/unit/pipeline-replay.test.js`, integration suites in CI |
| Live protoforge-core | UNVERIFIED | Not started on audit VM |

### Hybrid intelligence / routing

| Component | State | Evidence |
|-----------|-------|----------|
| `lib/ModelManager.ts` | OPERATIONAL (code + tests) | Cloud/local routing, `paid-llm-gate` |
| `lib/inference/intelligence-router.js` | DEGRADED | NCM optional; default LLM/Ollama; not enabled in PM2 by default |
| `services/ncm-inference/` | DISCONNECTED | Separate service; `HYDI_NCM_ENABLED` |
| Cloud providers (OpenAI/Anthropic) | DEGRADED | Adapters + gate; **$0 default** (`HYDI_ALLOW_PAID_LLM` false) |

### Memory & embeddings

| Component | State | Evidence |
|-----------|-------|----------|
| `heidi-core/memory/` (SQLite) | OPERATIONAL (unit) | `tests/unit/heidi-memory-system.test.js` |
| `hydi_facts` pgvector 768 migration | DEGRADED | Migration `20261117000000_*.sql` merged; **backfill not run** on audit VM |
| `scripts/backfill-embeddings.js` | UNVERIFIED | Requires live Supabase + Ollama |

### Heidi persistent agent

| Component | State | Evidence |
|-----------|-------|----------|
| `heidi-core/heidi-agent.js` + loop | OPERATIONAL (unit) | `tests/unit/heidi-agent-phase2.test.js` |
| PM2 `heidi-agent` :3462 | UNVERIFIED | In `ecosystem.config.js`; Frank not probed |
| Triple gate / `HEIDI_ALLOW_EXEC` | OPERATIONAL (code) | Default false in ecosystem |

### Execution fabric & missions

| Component | State | Evidence |
|-----------|-------|----------|
| `lib/execution-fabric/*` | OPERATIONAL (unit) | gateway, task-store, verification tests |
| Mission lifecycle (`heidi-core/missions/`) | OPERATIONAL (unit) | lifecycle tests |
| Postgres persistence | UNVERIFIED | `EXECUTION_FABRIC_PERSIST=postgres` in ecosystem |

### Evolution 2.0 / operational supervisor

| Component | State | Evidence |
|-----------|-------|----------|
| `lib/heidi/operational-supervisor.js` | OPERATIONAL (unit) | `tests/unit/operational-supervisor.test.js` |
| `lib/heidi/bounded-self-improvement-loop.js` | DEGRADED | Owner-invoked only (`scripts/heidi-self-improve.js`); not scheduled |
| Auto-merge / auto-deploy to prod | MISSING (by policy) | `frank-auto-deploy` fast-forward only; no agent auto-merge |

### Voice (local $0)

| Component | State | Evidence |
|-----------|-------|----------|
| Frank STT/TTS Python services | DEGRADED | Code in `services/voice/`; **no PM2 entry** |
| V3 `SpeechToTextAdapter` / `VoiceCommandRouter` | OPERATIONAL (unit) | `tests/unit/hydi-v3-voice-adapters.test.js` |
| Termux `heidi_voice.py` | OPERATIONAL (unit) | `tests/hydi_voice_phone_test.py` |
| End-to-end voice on Frank + phone | UNVERIFIED | Requires Jordan runbook |

### Mobile `/heidi`

| Component | State | Evidence |
|-----------|-------|----------|
| BFF `pages/api/heidi-mobile/*` | OPERATIONAL (unit) | `tests/unit/heidi-mobile-api.test.js` |
| Chat inline approval cards | DEGRADED | Client #628 merged; **`missionId` not found in server `lib/heidi-mobile/*.js`** — mission cards may depend on follow-up BFF |
| Tailscale PWA access | UNVERIFIED | Frank serve + device pairing |

### Revenue

| Component | State | Evidence |
|-------|-------|----------|
| Stripe Connect / revenue engine | DEGRADED | Code + tests; live Stripe not exercised on audit VM |
| Single vertical slice LEAD→PAY | UNVERIFIED | No production acceptance bundle |

---

## Credential inventory (names only — never values)

Present in **code paths** (may or may not be set on Frank):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`
- `HYDI_SERVICE_SECRET` (mobile session seal)
- `HEIDI_MOBILE_TOKEN`, `HYDI_PHONE_READ_TOKEN`
- `OLLAMA_URL` / local model flags
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (gated by `HYDI_ALLOW_PAID_LLM`)
- `STRIPE_*` (multiple webhook/account vars)
- `HYDI_PARTNERSHIPS_OPERATOR_SECRET` (partnerships path; not `HYDI_SERVICE_SECRET`)

**Audit VM:** no project `.env`; only `.env.local` partial for verify script (no Supabase keys loaded).

---

## Honesty statement

- **Merged PR ≠ production acceptance.**
- **Unit tests on cloud VM ≠ Frank/Android proof.**
- **PM2 "online" ≠ correct commit or functional capability** (see `lib/runtime/provenance.js`, `runtime:audit`).

Next operational truth refresh: Jordan runs Frank + phone acceptance matrix (`HYDI_ACCEPTANCE_MATRIX.md`) and appends SHA-dated evidence files under `.runtime/audit/` (not committed with secrets).