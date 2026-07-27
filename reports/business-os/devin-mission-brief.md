# Devin Mission Brief — HYDI System v2

Copy everything below the line into Devin as the task prompt.

---

## Mission

You are working on **HYDI System v2** (`clean-main`, currently at `02e6f1a`). Your mission is to clear the outstanding backlog in four ordered tasks, then stop and report. Do not start work beyond Task 4.

Read `CLAUDE.md` and `src/hydi-v3/RUNBOOKS.md` first. Runbooks 16 and 17 define the learning and evidence contracts you must not violate.

---

## The single most important thing to understand about this repository

This codebase has a **specific, repeated failure mode**: components that are fully written, fully tested, exported, documented — and **wired to nothing**. Six separate audits each found an instance:

| Component | What looked fine | What was actually true |
|---|---|---|
| `BusinessEventBus` (18A/B) | Built, tested, documented as "the single integration boundary" | Nothing outside the test suite ever constructed one |
| `ExecutionGateway` → learning (19) | `outcomeEngine` wired in, `_observeOutcome()` present, tests green | `recommendationId` was never copied onto the entry, so the guard field was always `undefined` and the hook could never fire |
| `EvidenceCollector` → providers (20) | Providers registered, collector subscribed, tests green | Sensors publish `source: 'GitSensor'`; providers are keyed `'git'`. Lookup returned null every time |
| `ExecutionGateway.approve()` (16) | Honoured a `simulate` config | Passed `false` unconditionally, so simulate mode still performed real side effects on approval |
| `PrinterOffline` / `DirectoryDeleted` (18E) | Sensors emitted them | No interpreter handled them; they vanished silently |
| `observeAction()` (19A) | Recorded outcomes | Recorded `actual = expectedValue` on completion — the system confirming its own forecast without measuring anything |

**Every one of these passed its unit tests.** Tests that construct a component directly and call its methods cannot detect that nothing in production constructs it, or that a linking field is dropped in between.

Therefore: **a green test suite is not evidence that your work functions.** It is necessary and not sufficient. See "Definition of done" below.

---

## Non-negotiable invariants

These came out of the audits. Violating any of them is a defect regardless of test results.

1. **Only measured evidence moves confidence.** This is settled — do not revisit it. An action completing means it *ran*, not that it delivered its predicted value. Evidence with no numeric `data.value` classifies an outcome but must not quantify it. `BusinessOutcomeEngine.js:134` enforces this; keep it.
2. **Simulation must never teach.** Nothing executed under `--dry-run` or a gateway `simulate` flag may produce an outcome, move confidence, or write to the audit ledger.
3. **Outcomes are terminal.** A recommendation gets one outcome. Re-observation must not add rows or ratchet confidence. `{ supersede: true }` is the only override.
4. **Zero is a measurement; missing is not.** Never substitute `0` for an absent value. `0` means "nothing was produced"; absent means "not measured". Conflating them caused a confirmed success to book a loss equal to its entire expectation.
5. **Units must not be mixed.** An activity count and a sum of money are different quantities. Do not aggregate them into one field. Do not compare a monetary value against a 0–1 score.
6. **Every sensor event type routes to exactly one interpreter.** `SignalCoverage.audit()` enforces this and runs at session startup. If you add an event type, add it to `SENSOR_EVENT_TYPES` and to exactly one interpreter, or the guard will fail.
7. **The gateway is the only path to real-world effects.** Sensors observe and never mutate. `ExecutionGateway` does not decide business success.
8. **Local-first.** No new cloud dependency. Stripe is the one permitted external service and only at the actual charge/read step. `--offline` must refuse network work, never hang.

---

## Task 1 — Fix two failing tests (do this first)

`tests/unit/hydi-v3/BusinessEvidenceEngine.test.js` has two tests that fail at `02e6f1a`:

- `records confirmed success from manual review and calibrates confidence`
- `records negative from manual review and lowers confidence`

Both assert that a manual review moves confidence. Invariant 1 says it must not — `BusinessOutcomeEngine.js:134` skips calibration when `measured === false`. **The tests are stale; the code is correct.**

Update both tests to assert the intended behaviour: manual review sets `outcomeType` and `classification`, records `measured: false`, leaves `actual` and `impacts.revenue` null, and leaves confidence **unchanged**. Add a short comment in each explaining why confidence does not move, referencing Runbook 16.

Verify `npm test` is fully green before starting Task 2. Report the true suite/test counts.

---

## Task 2 — Stripe revenue sensor (the main build)

Nothing currently supplies a measured business value, so recommendations accumulate in `getAwaitingOutcomes()` forever. This closes that loop.

Build, following the existing sensor pattern in `src/hydi-v3/GitSensor.js` and `GitRepository.js` — read them first and mirror their structure:

**`src/hydi-v3/StripeClient.js`** — read-only accessor.
- Read-only enforced *structurally*, not by convention: an explicit allowlist of endpoints, mirroring `GitRepository.ALLOWED_SUBCOMMANDS`. A future edit must not be able to make it write.
- Bounded timeout and response size.
- Never log, echo, or include the API key in any error, event, or persisted file. See `SECURITY_PROTOCOL.md`.
- Missing credentials, no network, or an API error are **normal conditions** — report an inactive reason, never throw a crash.

**`src/hydi-v3/RevenueSensor.js`** — publishes to `BusinessEventBus`.
- Poll settled payments only. A pending or failed charge is not revenue.
- Publish `PaymentSettled` (and `PaymentRefunded` if cheap) with a genuine numeric amount, normalised to major units, with currency recorded.
- Persist a cursor (`data/revenue-sensor-*.json`) using the same debounced/atomic/corrupt-archiving pattern as every other store.
- **Cold start adopts a baseline; it must not replay historical revenue as fresh income.** Follow `GitSensor`'s cold-start distinction between history and present state.
- Edge-triggered: a steady account produces zero events.

**Wiring:**
- Register a `financial` evidence provider producing evidence with `unit: 'currency'` and `measurement: true` — this is the first genuinely measured evidence in the system.
- Add the new event types to `SENSOR_EVENT_TYPES` in `SignalCoverage.js` and to exactly one interpreter.
- Wire into `OperatorSession` **opt-in and off by default**, torn down with the other sensors.
- Add CLI flags mirroring `--git`: `--stripe`, `--stripe-poll`, `--stripe-project`.
- Under `--offline` it must **refuse with a clear reason and not hang**. Add it to `NETWORK_ACTION_TYPES` handling in `OperatorMode` if applicable.

**Testing:** stub the HTTP layer. **Do not make live Stripe calls in tests.** Cover: cursor persistence across restart, the same payment never counted twice, cold start not replaying history, offline refusal, missing credentials, and a full recommendation → settled payment → measured outcome → confidence change cycle.

---

## Task 3 — Signal volume control

Five sources now feed one briefing: filesystem, git, manufacturing, learning, evidence. A single simulated manufacturing run produced 5 signals in seconds. Add deduplication, rate limiting, and per-objective prioritisation to `recentActivitySummary()` / `BriefingRenderer` so the Recent Activity section stays readable at realistic volume.

Keep the existing aggregate lines and the "Most recent" tail. Do not change their format — tests and the local dashboard depend on it.

---

## Task 4 — Report and stop

Write `reports/business-os/phase21-revenue-sensor.md` following the structure of `reports/business-os/phase18d-git-sensor.md`: implementation summary, architecture, files added/modified, **design decisions with rationale**, self-audit results, and a verification table.

Update `CHANGELOG.md` under `[Unreleased]` (Added / Changed / Fixed) and add a Runbook section for the revenue sensor.

Then **stop**. Do not begin further phases.

---

## Definition of done

A task is done when **all** of these hold. Green tests alone do not qualify.

```
npm run typecheck:hydi-v3     # 0 errors
npm run lint:hydi-v3          # 0 errors
npm test                      # all suites green — report true counts
npm run benchmark:performance # pass
```

**Plus live proof, which is the part that actually matters:**

- Boot a real `OperatorSession` with your component enabled and show the data arriving end to end — not a unit test, an actual run with output pasted into your report.
- Prove the **negative case** too. A guard that refuses everything also passes a "nothing happened" test. When you add a refusal (offline, dry-run, duplicate), demonstrate the corresponding **positive** path really works, so the refusal is meaningful rather than a broken code path.
- For anything you wire: show the linking field is populated at runtime. Do not assume it flows because you passed it.

**Before declaring done, run this checklist against your own work:**

1. Does anything outside the test suite actually construct this?
2. Is every field a guard depends on populated at runtime, or only in tests?
3. Can any input reach this and be silently dropped?
4. Can any input be processed twice?
5. Does anything claim a measurement it did not make?
6. Are any two different quantities sharing one field?
7. Does `SignalCoverage.audit()` still report `ok: true`?

---

## Environment and conventions

- Windows host; repository at `C:\Users\Owner\HYDI_System`.
- Primary branch is **`clean-main`**, not `main`.
- Node ≥ 20. A pre-push hook runs typecheck + full Jest suite.
- TypeScript strict mode is enforced. Catch variables are `unknown` — always `error instanceof Error ? error.message : 'Unknown error'`.
- Mixed CJS/ESM: be consistent *within* a file.
- Commit from Windows. Git run from a Linux/WSL side sees every CRLF file as modified and will rewrite line endings across the repository.
- **Separate commits per task.** Four tasks, four commits, each independently revertable, each with a message explaining *why* not just *what*.
- Never commit secrets. Never print an API key, even redacted.

## Reporting standard

For each task report: what you changed, **why you made each non-obvious design choice**, what you verified and how, and — importantly — **anything you found that was already broken**. Every audit of this codebase has found pre-existing defects. If you find none, say so explicitly rather than staying silent, so I know you looked.

If you hit a decision that is a business-meaning question rather than a code question, **stop and ask**. Do not guess. The one that already bit us: "does an owner's confirmation count as evidence?" is not answerable from the code.
