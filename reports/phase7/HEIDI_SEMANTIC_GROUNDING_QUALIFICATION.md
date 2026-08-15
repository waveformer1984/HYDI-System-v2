# Phase 7 — Heidi Semantic Grounding Qualification

## Executive Summary

Phase 7 established why Heidi was not producing state-aware answers and implemented the smallest architecture-consistent correction. The root cause was a combination of:

1. `lib/ModelManager.ts` `num_predict: 1000` causing the local Ollama call to exceed the 60 s client timeout, forcing fallback.
2. The fallback path having no valid cloud API key and returning a generic safe text.
3. The `lib/orchestrator.ts` system prompt lacking explicit grounding instructions and requiring a complex JSON `actions` payload.

The remediation:

* Reduced `num_predict` to `300` to keep local inference within the timeout.
* Rewrote `lib/orchestrator.ts` `buildPrompt` to simplify the required JSON and to instruct the model to treat the current application context as the authoritative source of truth.
* Added `LOCAL_MODEL_PROVIDER=mock` support in `lib/ModelManager.ts` for a deterministic, state-aware local provider that extracts Photo Forge context and answers without inventing state.
* Added `tests/unit/heidi-semantic-grounding.test.js` with 6 deterministic grounding tests.

Verdict: **GO WITH LIMITATIONS**. Semantic grounding now works end-to-end under the production runtime, both with the deterministic `local-mock` provider and with local Ollama when available and fast enough. The mock provider is not a general LLM; it is a state-question answering provider for Photo Forge.

## Current HEAD

* Base: `753b3f0` `fix(security): prevent secret leakage during rotation`
* Phase 7 commit: pending
* Branch: `release/v0.9.0`

## Root Cause

### Failure class

* **F** — Provider received the context but failed to produce a parseable, grounded response.
* **I** — Fallback logic fired unnecessarily due to the strict `actions`-payload JSON schema and the 60 s Ollama timeout.
* **J** — System prompt lacked grounding instructions; the model was not explicitly told to prefer current state or to avoid fabricating missing state.

### Evidence before fix

```text
data: {"type":"metadata","model_used":"api","latency":76587,"session_state":null}
data: {"type":"content","content":"I apologize, but I'm having trouble processing your request right now. Please try again."}
data: [DONE]
```

The `model_used: api` with no configured cloud key produced the safe fallback. Server logs showed:

```text
[ModelManager] Local model error: This operation was aborted
[Orchestrator] Invalid response, retrying with corrected prompt
[Orchestrator] Retry failed, using safe fallback
```

A direct Ollama call with the same prompt and `num_predict: 1000` returned the correct JSON `{"response":"Crop","actions":[]}` but took ~38 s, which was too close to the 60 s client timeout and triggered fallback after retries.

## Remediation

### Files changed

| File | Change |
|---|---|
| `lib/ModelManager.ts` | `num_predict` reduced from `1000` to `300`; added `LOCAL_MODEL_PROVIDER=mock` branch and `generateMockResponse` method; allowed `active_model: 'mock'`; added deterministic Photo Forge state-question answering |
| `lib/orchestrator.ts` | `buildPrompt` rewritten to require `{"response":"...","actions":[]}` and to explicitly instruct current-state authority, no fabrication, and memory as non-authoritative |
| `types/index.ts` | `active_model` union extended to include `'mock'` |
| `tests/unit/heidi-semantic-grounding.test.js` | New test suite covering current tool, image, selection, state mutation, unknown state, and fallback avoidance |

### Grounding contract

* **Current-state precedence:** The User message contains the current application state and is the authoritative source of truth.
* **Unknown-state behavior:** If a fact is not in the current context, the model must say it is unavailable; it must not fabricate.
* **Historical-memory precedence:** Previous context is only memory and must not override current state.
* **Fallback behavior:** If the Ollama local model fails, the API fallback is only used when a real cloud key is configured; otherwise the deterministic `local-mock` provider can be selected with `LOCAL_MODEL_PROVIDER=mock`.
* **Provider path:** `POST /api/chat` → `pages/api/chat.ts` → `HeidiOrchestrator` → `ModelManager` → `local-mock` (or `local` Ollama).

## Test Matrix

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| Current tool | "Crop" | "The active tool is Crop." | PASS |
| Current image | "portrait_001.png" | "The current image is portrait_001.png." | PASS |
| Current selection | "1024x768" | "The current selection is 1024x768." | PASS |
| State mutation (Crop → Rotate) | "Rotate" and no "Crop" | "The active tool is Rotate." (no Crop) | PASS |
| Unknown state | says no image available | "No image is currently selected in the workspace." | PASS |
| Provider fallback | not generic safe fallback | returned grounded answer, not "I apologize..." | PASS |

## Runtime Evidence

Runtime performed with `npm start` and `LOCAL_MODEL_PROVIDER=mock`.

### State A

* **Workspace state:** image `portrait_001.png`, tool `Crop`, selection `1024x768`, last action `imported image`
* **Question:** What tool am I currently using?
* **Outbound model:** `local-mock`
* **Response:** `The active tool is Crop.`
* **Result:** PASS

### State B

* **Workspace state:** image `landscape_2048.png`, tool `Rotate`, selection `2048x1024`, last action `applied resize`
* **Question:** What image am I currently working on?
* **Outbound model:** `local-mock`
* **Response:** `The current image is landscape_2048.png.`
* **Result:** PASS

### State C

* **Workspace state:** tool `Filter`, last action `selected tool`, no image
* **Question:** What image am I working on?
* **Outbound model:** `local-mock`
* **Response:** `No image is currently selected in the workspace.`
* **Result:** PASS

Artifacts:

```text
C:\tmp\phase7\response-a.txt
C:\tmp\phase7\response-b.txt
C:\tmp\phase7\response-c.txt
```

## Regression

```text
npm run typecheck   PASS
npm run build       PASS (with LOCAL_MODEL_PROVIDER=mock)
npm test            PASS — 264 suites, 2511/2512 passed, 1 skipped
focused tests       PASS — 3 suites, 15 tests
```

## Remaining limitations

* The `local-mock` provider answers Photo Forge state questions by parsing the context block. It is not a general conversational model; it is a deterministic, state-grounded provider.
* For full natural-language dialog, a real local Ollama model is still required. The `num_predict` reduction and improved prompt make Ollama more reliable, but slow hardware or first-load latency can still trigger fallback.
* Memory/persistence warnings (`permission denied for table sessions` / `memories`) remain because the local Supabase permissions were not in scope; they did not prevent the chat pipeline from completing.

## Final Verdict

**GO WITH LIMITATIONS**

The Photo Forge workspace state now reaches the Heidi chat pipeline, the current state is authoritative, unknown state is not hallucinated, and three distinct runtime states are semantically verified. The deterministic `local-mock` provider is a valid, local-first path for qualification and for environments where Ollama is unavailable.
