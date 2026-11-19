# HYDI implementation roadmap (hybrid intelligence)

**After Phase 0 audit — smallest verifiable slices first.**  
**Baseline:** `06cf644d7325ac8b4488913253de54e02b57fb30`

---

## Priority 0 — Truth on Frank (no new features)

| Slice | Files / commands | Depends on | Tests | Acceptance |
|-------|------------------|------------|-------|------------|
| P0.1 Frank evidence capture | `npm run runtime:audit`, `GET /api/phone/observe`, curl voice `/health` | B1 | — | A3, A4 in matrix |
| P0.2 Supabase read-only | `verify-supabase.sh`, counts on `hydi_facts`, `heidi_state_snapshots` | B2 | migration tests | A6 |
| P0.3 Embeddings backfill | `scripts/backfill-embeddings.js --apply` (Frank only, after DB up) | B3 | `tests/migrations/20261117000000*.test.js` | A6 |

---

## Priority 1 — Wire merged capabilities (extend, don’t fork)

### P1.1 Voice on Frank (ops)

- **Reuse:** `services/voice/*`, `docs/runbooks/HEIDI_VOICE_V1.md`
- **Change:** optional `ecosystem.config.js` apps `heidi-voice-stt` / `heidi-voice-tts` (loopback + `VOICE_BIND` doc)
- **Blocker:** B4, B6
- **Tests:** existing pytest + Frank curl (Jordan)

### P1.2 Mobile approval contract completion

- **Reuse:** `lib/heidi-mobile/client/taskDecision.ts`, `pages/api/heidi-mobile/chat.js` normalizer
- **Change:** emit `missionId` in SSE `actions` (server); no client fork
- **Blocker:** B5
- **Tests:** `tests/unit/heidi-mobile-api.test.js` chat stream fixture

### P1.3 V3 voice → production caller

- **Reuse:** `src/hydi-v3/VoiceInterface.js`, adapters, router safety
- **Change:** single integration point (e.g. console API or heidi-core tool) — **not** new orchestrator
- **Tests:** extend `hydi-v3-voice-adapters.test.js`

---

## Priority 2 — Hybrid intelligence (Phase 2 directive)

Build on **`lib/ModelManager.ts`** + **`lib/inference/intelligence-router.js`**:

1. Model capability registry file (extend existing `lib/inference/engines.js` — no duplicate registry DB).
2. Task → provider routing table with **privacy flag** (local-only tasks never call cloud).
3. Health checks: Ollama tags, optional cloud HEAD/latency (gated).
4. Fallback chain: local → cloud (only if `HYDI_ALLOW_PAID_LLM` + key present).
5. Metrics: latency ms + `reason` in existing structured logs.

**Resource gate:** complete B7 before enabling NCM or extra Ollama models.

---

## Priority 3 — Memory (Phase 3)

- Verify migration applied; run backfill (P0.3).
- Semantic retrieval test harness against live `hydi_facts`.
- Do **not** schedule backfill cron until P0.2 passes.

---

## Priority 4 — Execution (Phase 4)

- Reuse `lib/execution-fabric/` + mission worker; align status enums with existing lifecycle doc.
- No new auto-approve paths; voice/mobile remain typed confirmation.

---

## Priority 5 — Self-improvement (Phase 6)

- Reuse `bounded-self-improvement-loop.js`; each proposal → branch → CI → human PR.
- Forbidden: auto-merge, permission self-modification.

---

## Priority 6 — Revenue (Phase 7)

- One vertical slice: existing revenue-engine + Stripe test mode.
- Track actual `cs_test_` / ledger rows; exclude test mode per `lib/revenue/stripe-mode.ts`.

---

## Next implementation PR (recommended first code slice)

**Title:** `ops: PM2 voice services + BFF missionId for chat approvals`  
**Branch:** off `clean-main`  
**Files (estimate):** `ecosystem.config.js`, `lib/heidi-mobile` chat normalize (server), tests only — **no new ports** beyond 9000/9001 already defined.

**Not started in this audit turn** — per MASTER DIRECTIVE: audit first, then smallest slice.