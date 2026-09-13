# Bounded cognitive loop

**Date:** 2026-09-08
**Files:** `lib/embeddings.ts`, `lib/heidi/CognitiveCore.ts`, `tests/unit/bounded-cognitive-loop.test.ts`

---

## The defect

`CognitiveCore.runCycle()` could block forever.

A loop is only "bounded" if every `await` inside it is bounded. Both memory call sites were wrapped in `try/catch`, which looks like handling — but **a promise that never settles never throws**, so the catch never runs. Rejections were always survivable; non-settlement was not.

The unbounded call was `generateEmbedding()`, which used a bare `fetch` with no abort signal. `lib/heidi/ExecutionBridgeAdapters.ts:63` → `storeExperience` → `learnFromCycle` → `runCycle`.

`ModelManager` already bounded the generative path with an `AbortController` (60s). Embeddings were the only unbounded network call in the cycle.

## How it presented

`tests/unit/heidi-cognitive-loop-qualification.test.ts` failed **8 of 14 tests, all by timeout at ~120000ms**. Not assertion failures — the tests never got an answer. `TEST D` is a bare `await core.runCycle()` and still timed out.

Confirmed pre-existing by stashing unrelated work and re-running the full 1000s suite: byte-identical failures.

## The fix

**`lib/embeddings.ts`** — both provider fetches now run under a deadline:

```
EMBEDDING_TIMEOUT_MS   default 15000
```

Deliberately much tighter than `LOCAL_MODEL_TIMEOUT_MS` (60s, sized for a cold 7B generative load). Embedding models are small — `nomic-embed-text` is 274MB — and this runs on the memory write of *every* cycle. A budget sized for a cold 7B load would let one wedged runner cost a minute per cycle.

`AbortController` rather than `AbortSignal.timeout`, so the timer is explicitly cleared — an uncleared timer keeps the event loop alive and turns a fast path into a slow exit.

**`lib/heidi/CognitiveCore.ts`** — `withDeadline()` wraps both memory call sites as a backstop for everything else on that path (Supabase insert, dynamic import, a misbehaving adapter):

```
HEIDI_MEMORY_TIMEOUT_MS   default 20000
```

The abandoned promise is explicitly swallowed so a late rejection does not surface as an unhandled rejection in a cycle that already moved on. An overrun is **recorded** in `state.errors` / lessons, never silently dropped — a cycle that quietly skips its memory write looks identical to one that succeeded.

## Result

Loop qualification: **6/14 → 12/14** with the bound alone, then **13/14** once embeddings were pointed at a working model.

The live run showed the mechanism working: 9 instances of `Ollama embeddings timed out after 15000ms` where previously those calls never returned at all.

The one remaining failure, `TEST G`, is a single `runCycle()` that took 126s against a 120s budget. Its siblings ran 82s (D), 95s (E), 86s (I) — cycles here are 40–95s, dominated by local LLM inference, and G straddled the line. Not raising the budget: that would mask hardware slowness the same way it would have masked the unbounded await.

---

## The environment fault this exposed

The remaining slowness is **not** a HYDI defect. Measured on this machine:

| endpoint | model | result |
|---|---|---|
| `/api/tags`, `/api/ps` | — | instant |
| `/api/generate` | `llama3.2:3b` | 200 in 3.8s |
| `/api/embeddings` | `llama3.2:3b` | 200 in 0.4s |
| `/api/embeddings`, `/api/embed` | `nomic-embed-text` | **hangs indefinitely** |
| `/api/embed` | `all-minilm` (freshly pulled) | **hangs indefinitely** |

Ollama **0.21.0** could not start a runner for *any* true embedding-architecture model on this box. Generative models were fine, and served `/api/embeddings` fine. Resolved by upgrade — see below.

Diagnostic path, for the record:
1. Re-pulled `nomic-embed-text` → `{"status":"success"}` instantly, still hung. Not corrupt blobs; the manifest is current.
2. Checked the running processes: the only `ollama runner` child holds blob `dde5aa3f…`, which belongs to **llama3.2** — a healthy runner, not a wedged nomic one. There is no nomic runner at all; the server cannot start one.
3. Pulled `all-minilm` fresh (6s) as a control. Also hangs. That rules out the model and points at Ollama itself.

`server.log` is stale (Jul 3) because `ollama serve` was started from a terminal, so its output is not captured to a file.

### Resolution

Two steps, in that order, each measured.

**1. Restarting `ollama serve` — partial.** The hang became a completion, but the model would not stay resident:

| call | latency |
|---|---|
| first (cold) | 36.4s |
| warm 1 / 2 / 3 | 12.0s / 32.8s / 29.2s |
| with `keep_alive: 5m` | 13.3s / 30.6s / 25.0s |
| `/api/ps` after each | `{"models":[]}` |

Every call paid a full model load, and `keep_alive` did not change that. A 274MB embedding model reloading on every call while a 2.4GB generative model stayed warm is the same embedding-runner defect, degraded rather than fatal.

**2. Upgrading Ollama 0.21.0 → 0.33.3 — resolved.** Via `winget upgrade --id Ollama.Ollama`. All seven local models preserved. The installer also restored the supervised setup (`ollama app.exe` + `ollama.exe`), replacing the orphaned manually-started server.

| | 0.21.0 | 0.33.3 |
|---|---|---|
| cold load | 36.4s | **4.9s** |
| warm calls | 12–33s | **0.21s / 0.24s / 0.20s** |
| residency (`/api/ps`) | never resident | **resident** |

Roughly 100× faster warm, and residency restored.

### What this says about the timeout budget

`EMBEDDING_TIMEOUT_MS=15000` now sits comfortably above both cold load (4.9s) and warm calls (0.2s), so it never fires in normal operation — which is what a timeout should do.

Worth recording that the budget was **not** tuned to fit the broken environment. Under 0.21.0, calls took 13–33s and the 15s bound would have aborted most memory writes. Raising it to ~35s to "fix" that would have reintroduced exactly the multi-second per-cycle stall the bound exists to prevent, and would have hidden a genuine dependency fault behind a slower loop. The environment was fixed instead.

**Cleanup:** `all-minilm` (~45MB), pulled purely as a diagnostic control, has been deleted.

## Why the bound matters regardless

The Ollama fault is transient and fixable. The defect it exposed is neither: any embeddings backend — local or hosted — can stall, and until this change a stall anywhere on that path stopped HYDI's cognitive loop permanently, with no error, no log line, and no recovery.

"Is the server up?" could not have caught it. Ollama answered `/api/tags` in milliseconds throughout.


---

## Postscript: the advisory layer caught a flaw in itself

Persisting `contractDisagreement` (see `docs/CAPABILITY_CONTRACT.md`) paid off on the first real measurement. Three capabilities were resolving to **R4** — "highly sensitive, explicit human authorization":

```
goal.advance                55 cycles   8 disagreements  15%   R4
tool.create_task            26 cycles   6 disagreements  23%   R4
revenue.identify_prospect    2 cycles   1 disagreement   50%   R4
```

All three named the same two drivers: `reversibility=none` and `unattended=no human present`. Blast radius was `single_resource` in every case — so the bounds were fine. This was not the "contract bounds are too loose" case.

**Two real errors, both mine:**

1. **`unattended` double-counted.** The authority function added a tier when no human was present, reasoning that "an approval nobody can grant is a stop." That is right about the outcome and wrong about the mechanism: being unattended does not make an action more dangerous, it makes approval *unavailable* — and the stop already happens via `requiresApproval` plus the delegation check. Adding a tier on top counted the same fact twice. Now recorded as a factor with `escalation: 0`.

2. **`goal.advance` / `goal.complete` declared irreversible.** A goal status write can be set back — the identical self-inverse pattern `revenue.update_prospect_status` already used, which is precisely why that capability showed **zero** disagreements while `goal.advance` showed 15%. The asymmetry was in the declaration, not the system.

Resulting tiers, unattended:

| tier | capabilities |
|---|---|
| R0 | `world.query`, `cognitive.observe`, `revenue.get_verified_revenue` |
| R2 | `goal.advance`, `goal.complete`, `revenue.update_prospect_status`, `recovery.*` |
| R3 | `tool.create_task`, `revenue.identify_prospect`, `revenue.create_opportunity`, `revenue.run_cycle` |
| R4 | `comm.send_message`, `revenue.activate_service` |

`tool.create_task` stays at R3 against a legacy R1. That one is case (a) — a durable row a worker will pick up and execute, with no registered undo. The contract is right and the static level was optimistic. It should be left to require approval.
