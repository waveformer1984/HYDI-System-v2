# HYDI Next Phase Recommendation

## Guiding principle

Choose the smallest number of high-value phases. Prioritize effort that converts the most `PARTIAL` or `NOT VERIFIED` items to `PASS`.

## Recommended next phases

### Phase 6 — Local-First Network Re-Verification

**Goal:** Produce current packet-level evidence that the local-first boundary still holds.

**Why:** Phase 15 evidence is historical. Code has changed. Re-verification is cheap and high-value.

**Work:**

1. Run `npm start` in a clean environment.
2. Capture traffic with `tcpdump`/ `netsh` for the Phase 5 acceptance window.
3. Confirm 0 non-local packets during core operation.
4. Update `artifacts/phase15-network-capture.pcap` or create a new artifact.

**Effort:** low
**Value:** very high (resurrects a P1 blocker to PASS)

### Phase 7 — Deterministic Heidi Semantic Grounding

**Goal:** Prove Heidi can answer state questions correctly with a deterministic local model.

**Why:** The chat transport works, but the response is a safe fallback. Semantic correctness is the next high-value gap.

**Work:**

1. Implement `LOCAL_MODEL_PROVIDER=mock` in `lib/ModelManager.ts` or `api/local-model.js`.
2. Create a mock that returns a canned, state-aware answer when the Photo Forge context is recognized.
3. Run `POST /api/chat` with State A/B and assert the response contains the current tool/image/selection.
4. Add a focused test for the mock provider.

**Effort:** medium
**Value:** very high (closes P1 chat-pipeline blocker)

### Phase 8 — Photo Forge Image Data Capability

**Goal:** Move Photo Forge from workspace state to actual image handling.

**Why:** Photo Forge is currently a UI shell. Real image loading or transformation is the missing functional capability.

**Work:**

1. Choose a minimal real mechanism: HTML5 Canvas with a sample image, or file upload to a local Blob.
2. Implement `Crop`/`Resize`/`Filter`/`Generate` as actual canvas operations or transformations.
3. Update `buildPhotoForgeContext` to include output dimensions/filters.
4. Re-qualify under `npm start`.

**Effort:** high
**Value:** high (but depends on whether Photo Forge is a strategic product or a demo)

### Phase 9 — Security and Configuration Hardening

**Goal:** Fix the immediate P1 secret logging and CORS issues.

**Why:** `scripts/rotate-secrets.js` logs new secrets; CORS `*` on sensitive endpoints is a real risk.

**Work:**

1. Remove `console.log` of secrets in `scripts/rotate-secrets.js`.
2. Replace hardcoded `'*'` CORS with `process.env.MOBILE_CHAT_ORIGIN` on `api/checkout.js`, `api/dashboard-status.js`, `api/ursula/status.js`.
3. Complete Ursula JWT Bearer migration.
4. Add prompt-injection detection before LLM calls.

**Effort:** low
**Value:** high

### Phase 10 — Operational Qualification Completion

**Goal:** Execute the remaining `operational-qualification` phases.

**Why:** The harness is ready, but full certification is withheld for lack of infrastructure.

**Work:**

1. Run `npm run operational-qualification` quick mode.
2. Run 1-hour soak.
3. Run failure injection in isolated environment.
4. Produce updated qualification report.

**Effort:** high (needs dedicated host)
**Value:** very high (required for production certification)

## Prioritized roadmap

| Phase | Effort | Value | When |
|---|---|---|---|
| 6. Network re-verification | low | very high | first |
| 9. Security hardening | low | high | first |
| 7. Heidi semantic grounding | medium | very high | second |
| 10. Operational qualification | high | very high | third (needs host) |
| 8. Photo Forge image data | high | high | fourth (if strategic) |

## Capabilities that should NOT be the next priority

* Adding more unit tests for already-tested areas.
* Installing browser automation frameworks solely for screenshots.
* Large refactors of the six-layer pipeline or KILO/ProtoForge gating (already implemented and tested).
* Cloud AI provider integration (contradicts local-first priority).
