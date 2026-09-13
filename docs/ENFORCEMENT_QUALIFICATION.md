# Enforcement qualification report

**Date:** 2026-09-08
**Telemetry window:** `2026-09-08 19:43:05+00` onward (post-correction only)
**Verdict:** `ADVISORY_REQUIRED`

---

## Contract coverage

**45 / 45** contracted. 0 on the legacy verification chain. All 45 validate structurally with zero errors.

Count rose from 43 after closing the `run_cycle` bypass revealed two operations (`revenue.start_provisioning`, `revenue.update_health_status`) with no contract at all — reachable only as direct method calls inside `RevenueControlLoop`.

## Independent verification

| category | count |
|---|---|
| independently verified (re-reads a durable record or an authoritative subsystem) | 20 |
| reads verified by their own response | 22 |
| writes NOT independently verified | **3** |
| unexercised capabilities | **24** (was 41) |

The three remaining writes, each classified with a reason rather than a label:

| capability | class | why |
|---|---|---|
| `tool.send_email` | `provider_acceptance` | Resend accepted and issued an id. Upgrade path exists (`GET /emails/{id}`) but needs an `http_probe` observer and an API key absent here. |
| `self_sufficiency.run_self_repair` | `unverifiable` | Outcome is composite — repaired vs correctly escalated are indistinguishable from outside the engine. Marked `requiresHumanConfirmation: true`, forcing R3 minimum. |
| `revenue.run_cycle` | `self_report` | Writes nothing itself; its six mutating calls are now each governed by their own contract. Its own response shape is all there is to check. |

`comm.send_message` left this list by gaining a real source (`CommunicationLayer.verifyDelivery`), not by reclassification.

## Authority

| tier | count |
|---|---|
| R0 | 22 |
| R2 | 10 |
| R3 | 7 |
| R4 | 6 |

- Contracts stricter than their legacy declaration: **20**
- Disagreements before correction: `goal.advance` 15%, `tool.create_task` 23%→100%, `revenue.identify_prospect` 100%
- Disagreements after correction: **0** — across only 4 exercised capabilities

## Qualification matrix

| status | count |
|---|---|
| FAILED | 0 |
| DISAGREEMENT | 0 |
| EXERCISED_BUT_UNVERIFIABLE | 0 |
| SELECTED_NOT_EXECUTED | 1 |
| VALIDATED | **21** |
| NOT_EXERCISED | **24** |

Raised from 3 by the capability exercise harness (`npm run capability:exercise`), which drives each contract deliberately through the real executor and the real verification rather than waiting for the cognitive loop to select it. Harness results are persisted as `capability_exercise` events so the matrix has one source of truth — otherwise this report and the harness report would disagree about the same 45 contracts.

**The 24 remaining, by reason:**

| reason | count | note |
|---|---|---|
| UNSAFE to automate | 10 | documented real-world consequence; see below |
| needs a fixture | 10 | takes a prospect / service / row that must be constructed deliberately |
| no wired executor | 3 | `tool.create_task`, `tool.schedule_event`, `tool.fetch_data` — ActionExecutor bridge unavailable in this environment |
| prerequisite unavailable | 1 | `tool.cancel_task`, blocked by the above |

The 10 UNSAFE are refused on purpose. A harness that fired `tool.send_email` or `revenue.activate_service` to turn a status green would create real external effects to produce a number, and would have to self-authorize past the governance model it exists to qualify. Each carries its reason, which is the gate's "explicit documented reason", not a silent omission.

`exerciseCapability()` also refuses R3+ without an explicit `--approve` token, and records the refusal.

## Runtime

**Cognitive-loop qualification: 12/14.** Failures `TEST G` (120303ms) and `TEST I` (120011ms), both timeouts, no assertion failures. Across five runs the failing set differs every time ({D,E}, {G}, {D,G,I}, {D,E,G,I}, {G,I}) while cycles run 28–128s against a 120s per-test budget. This is a timing race, not a defect. The budget was **not** raised.

**Ollama:** version 0.33.3. Generative inference healthy (899ms). The embedding fault is **not** a version defect and **not** fixed by the upgrade — it is model co-residency:

| condition | `nomic-embed-text` |
|---|---|
| `llama3.2:3b` resident | 60–70s hang (3 consecutive), then 6.2s on a later attempt |
| `llama3.2:3b` unloaded | **4.2s cold, 0.211s warm, stays resident** |

Unloading the generative model makes embeddings reliably fast; with it resident, embedding loads are unreliable — observed both indefinite hangs and 6s successes. Since the cognitive loop keeps `llama3.2:3b` loaded, embeddings fail for most of a run. Remedy is `OLLAMA_MAX_LOADED_MODELS=1` (evict rather than hang), more memory, or `OLLAMA_EMBEDDING_MODEL=llama3.2:3b` (0.4s, no swap).

**Bounded memory writes: enforced, confirmed live.** The run produced **29 timeouts at exactly 15000ms** with `CognitiveCore.withDeadline` in the stack, against a genuinely non-responsive endpoint. The 20s `CognitiveCore` backstop never fired because the inner 15s bound fires first, as designed. Unit coverage additionally exercises a server that accepts and never answers.

## Full regression

| suite | result |
|---|---|
| `tsc --noEmit` | **clean** — but see the caveat below |
| eslint (my files) | **0 errors**, 31 warnings |
| eslint (whole repo) | 7 errors — all `prefer-const` in pre-existing test files not touched by this work |
| contract tests | 96 / 96 |
| revenue governance tests | 4 / 4 |
| revenue engine tests | 57 / 57 |
| executor tests | 10 / 10 |
| bounded-loop + cognitive-core + qualification + autonomy ×2 | 99 / 99 |
| cognitive-loop qualification | 12 / 14 (2 timeouts, no assertion failures) |
| capability coverage | 45 contracted, 0 legacy |
| disagreement telemetry | 0 across 4 exercised |

**266 passing** across the ten deterministic suites.

**Correction on an earlier claim.** `tsconfig.json` excludes `scripts` and `tests`, so every `tsc --noEmit` reported in this work covered `lib/` — where the contracts live — but never the qualification scripts or the test files. That gap is how a syntax error in the harness reached runtime instead of the compiler. Checked explicitly with a temporary config: the five `capability-*` scripts have **0** type errors; the 114 errors in `scripts/` are all pre-existing files, which is presumably why the directory is excluded.

---

## Verdict: `ADVISORY_REQUIRED`

Seven of the ten gate conditions hold. Three do not.

### Blockers

**1. 24 of 45 remain unexercised** (was 41).
The exercise harness closed 18 of them. What remains is not a tooling gap: 10 are unsafe to automate with documented reasons, 10 need deliberately constructed fixtures, and 3 have no wired executor in this environment. The R4 tier is still almost entirely unexercised — which is where enforcement bites hardest.
*Smallest next action:* build prospect/service fixtures for the 10 `needs a fixture` entries; configure the ActionExecutor bridge to recover the 3 `no wired executor` entries. The 10 UNSAFE need a decision about whether a sandbox exists for each, not more automation.

### Closed during this phase

**~~`revenue.run_cycle` governance bypass.~~ CLOSED.**
`RevenueControlLoop` now authorizes each of its six mutating operations against its own contract via a `CapabilityGovernor`, and records every one in `RevenueControlLoopResult.governance` — including as `ungoverned` when no governor is supplied, so the bypass cannot silently return. Closing it revealed that two of those operations (`startProvisioning`, `updateHealthStatus`) had **no contract at all** — not weakly verified, invisible — so contract count went 43 → 45. `run_cycle` keeps subsystem scope and R4: per-operation governance bounds each step, it does not make the composition equivalent to a single R2 action.

**2. `comm.send_message` cannot verify in this environment.**
The independent path is implemented, but `conversationStore.getMessage()` selects `message_id`, which does not exist in `chat_messages` (`id, conversation_id, sender_type, content, tool_call, created_at`). It will report `error`. That is the correct failure — but it means an R4 external-communication capability has no working verification.
*Smallest next action:* reconcile the `chat_messages` schema with `conversationStore`, or correct the store to the live schema.

**3. Embedding provider unreliable under normal load.**
Not an application defect, and the bound contains it — but 29 memory writes were dropped in a single run. Enforcing authority on a system silently losing most episodic memory would qualify the wrong thing.
*Smallest next action:* set `OLLAMA_MAX_LOADED_MODELS=1` or `OLLAMA_EMBEDDING_MODEL=llama3.2:3b`, then re-run and confirm zero embedding timeouts.

### Conditions that DO hold

- All 45 contracts validate structurally
- No capability falls through to executor-reported success — the fallback now reports `unverified` and names the uncontracted capability
- Weak writes are independently verified or explicitly classified, none silently
- All observed disagreements reviewed and their *sources* corrected, not their tiers
- Corrected authority declarations exercised against fresh post-correction telemetry
- Bounded memory writes enforced, confirmed under a live non-responsive endpoint

`HEIDI_CONTRACT_AUTHORITY` has **not** been changed. It remains `advisory`.
