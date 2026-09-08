# Capability Contract — audit and layer

**Status:** migration complete — all 43 capabilities contracted, legacy if-chain deleted. Verification enforcing, authority advisory.
**Package:** `lib/capability-contract/`
**Date:** 2026-09-08

---

## 1. What the audit found

HYDI has four parallel governance stacks. Each holds one piece of the answer. None of them share a descriptor.

| Location | What it has | What it lacks |
|---|---|---|
| `lib/heidi/CapabilityRegistry.ts` | 42 registered capabilities, provider, dependencies, timeout | `riskLevel` is a static constant; `verificationStrategy` is English prose; no effects, no cost, no signature, no simulation |
| `lib/delegated-operator/VerificationContract.ts` | Genuinely executable predicates — conditions, operators, failure classification | Orphaned from the registry. Used only by `scripts/` and tests |
| `lib/human-action/AuthorityManager.ts` | Resource patterns, time-bounded delegation, confirmation policy | Separate tree, separate types, not consulted by the planner |
| `lib/operational/CapabilityAuthorizer.ts` | Real enforcement | A hardcoded `RESTARTABLE_MODULES` allowlist — every new target is a code edit |

The consequence is visible in `lib/heidi/CognitiveCore.ts:1781`: `verifyAction()` is a hand-written if-chain over capability ids, roughly 270 lines of it. **Every new capability requires editing the planner.** That is the ceiling on the whole system, and it is the thing "capability composability" has to remove.

### Two specific defects

**False green by default.** `VerificationContractRegistry.verify()` returns `verified: true` when no contract is registered — commented as "No contract = trust the adapter". The default answer to *did this work?* is **yes**, precisely for the capabilities nobody specified. That is backwards; the new layer fails closed.

**Rationale is captured but not durable.** `src/hydi-v3/DecisionJournal.js` has exactly the right shape — `inputs`, `selected`, `rejected`, `rationale` — and stores it in a process-local array. It dies with the daemon. The "why did we abandon that approach?" capability cannot be built on a structure that does not survive a restart.

### Contract coverage of the existing 42

Run `npm run capability:gap-map`.

| Field | Status across the 42 |
|---|---|
| identity (id) | present |
| identity (version, owner) | **missing** |
| typed signature | **missing** — all params are `Record<string, unknown>` |
| preconditions | **missing** |
| authority as a function | **missing** — static `riskLevel` |
| effects / blast radius | **missing** |
| reversibility | boolean only; no inverse named (39 of 42 claim `true`) |
| verification predicate | **missing** — 42 of 42 are prose |
| observability | partial — three separate journals |
| cost | timeout only |
| simulation | **missing** |

---

## 2. What was built

`lib/capability-contract/` — 13 modules, 51 tests, plus 21 migration tests. `tsc --noEmit` clean; `eslint` clean on all new files.

### The contract (`types.ts`)

One descriptor the planner consumes, and nothing else: identity, signature, preconditions, effects, reversibility, cost, verification, observability, simulation, interlocks, authority.

### Authority is computed, not declared (`Authority.ts`, `BlastRadius.ts`)

Tier is a function of `(verb × target × blast radius × reversibility × system state)`.

```
files.delete  { path: "/tmp/build.log" }   → R2
files.delete  { path: "/etc/passwd"    }   → R4   (escaped declared patterns)
```

Same capability, same verb, different tier. Every escalation is recorded as a named factor so the decision is explainable in an audit record.

`R5` means **categorically prohibited**, not "very risky". Accumulated context escalation clamps at R4; only an explicit prohibition (an unarmed physical interlock, an unregistered step in a plan, an unbounded repair loop) reaches R5.

### Validation is the forcing function (`ContractValidator.ts`)

> A capability that cannot state its own success predicate is capped at **R1 (recommend-only)**, permanently, regardless of how safe it looks.

Also enforced at registration: unredacted secret parameters, a claimed inverse with no named capability, a mutating effect with no resource patterns, a physical effect with software-only safety, a predicate that cannot fail.

### Verification fails closed (`Verification.ts`)

Absent predicate, absent observation source, or missing observer → `unverifiable`, never `verified`. An action that succeeded and cannot be checked is reported as `unverified` — a 201 and an exit code 0 are not evidence.

Observers are registered per source (`filesystem`, `http_probe`, `camera`, `sensor`, `ledger`…). This is what makes a camera and a Postgres table interchangeable to the planner.

### Self-repair whitelists plans, not primitives (`RepairPlaybook.ts`)

The failure mode: `config.edit` is R2, `service.restart` is R2, both whitelisted — and the composition is an unreviewed deployment that never leaves R2.

Playbooks are the unit of authorization. Composed tier escalates above `max(steps)` when a sequence mutates across subsystems, exceeds five steps, declares no abort conditions, or has no expected outcome. Playbooks are assessed against a **worst-case state at registration** (production, unattended, incident open, degraded) so a dangerous plan cannot be laundered by evaluating it on a quiet afternoon. `isWhitelistedSequence()` rejects improvised sequences of individually-permitted steps.

### Sub-agents propose; the control plane commits (`CommitGate.ts`)

Enforced structurally, not by convention: a `Proposal` carries nothing callable. There is no code path from holding one to causing an effect. Per-proposer ceilings apply independently of the human delegation — a research agent can be capped at R1 even when the owner's delegation permits R4.

### Physical interlocks (`SafetyInterlock.ts`)

Software watches; hardware stops. A capability actuating a physical machine is capped at R1 unless it declares an interlock that holds independently of this software, and drops to R5 when a declared interlock is not confirmed armed within a freshness window (default 60s). A failing probe reads as *not armed*, never as armed. `FDM_PRINT_INTERLOCKS` is the reference set for an unattended print cell: firmware thermal runaway, thermal fuse, smoke-detector relay, latching e-stop.

This module deliberately does **not** implement stopping. Stopping belongs to the fuse and the relay. HYDI's job is to refuse to start.

### Decision records (`DecisionRecorder.ts`)

Durable, append-only, indexed by subject. Rejects a record with fewer than two alternatives or no rationale — a decision with one option is a log line pretending to be reasoning. `recall()`, `search()`, and `needsRevisit()` answer the six-months-later question from what was written at the time.

### Cost and simulation (`Simulation.ts`)

Duration, money, materials, wear. `checkBudget()` is a second, independent brake: authority asks *may I?*, the budget asks *can we afford to be wrong about this this many times?*

### Reference contracts (`contracts/reference.ts`)

`repo.run_tests` and `protoforge.print_job`, written out in full. One takes 90 seconds, costs nothing, is reversible, verifies by exit code. The other takes six hours, consumes 84g, cannot be undone, can start a fire, verifies by camera. **The planner tells them apart by reading numbers, not by having a special case for 3D printers.** They are also the template: a capability whose contract cannot be filled in this concretely is not ready to run above R1.

---

## 3. Commands

```bash
npm run capability:gap-map    # what the 42 legacy descriptors are missing
npm run capability:audit      # CI gate: capabilities that can act but cannot be checked
npx jest tests/unit/capability-contract.test.ts
```

---

## 4. CognitiveCore migration (done)

`lib/heidi/CognitiveCore.ts` now consults the contract layer. Two new files carry it:

- **`lib/heidi/ContractVerification.ts`** — the observers. Each knows how to read one kind of world; none knows which capability it is verifying.
- **`lib/heidi/contracts/cognitive-contracts.ts`** — 14 contracts, one per branch of the former if-chain.

### Verification: contract-first, no silent fallback

```ts
if (action.capabilityId && this.contracts.get(action.capabilityId)) {
  return this.verifyThroughContract(action, exec, state);
}
// legacy chain below — retired branch by branch
```

A contracted capability is verified by its own predicate and **that answer is authoritative**. There is deliberately no fallback to the legacy chain, because "the contract could not check it" must not quietly degrade into "the executor said it worked". `unverifiable` and `error` are reported as themselves rather than collapsed into `failed` — not knowing is a different problem from knowing it went wrong.

### Observer target grammar

| source | target | reads |
|---|---|---|
| `database` | `goal:{targetGoalId}` | `GoalSystem.getGoal()` |
| `database` | `sql:<table>:<column>={placeholder}` | `SELECT … WHERE col = $1` |
| `process` | `health:{component}` | `operationalIntelligence.checkHealth()` |
| `process` | `service:{serviceId}` | `revenueLifecycle.verifyService()` |
| `api_response` | `response` | the executor's own return value |

Placeholders resolve from the invocation arguments **first**, then from the executor's result — an id supplied by the caller is more trustworthy than one echoed back by the thing being verified. A target that cannot be resolved raises, rather than verifying against an empty row. Table and column names are identifier-checked (values always go through bound parameters); non-identifier `extractFields` are dropped rather than interpolated.

Sources with no live dependency are **not** registered. An unregistered source yields `unverifiable`, which is the correct answer — a stub observer returning a pass would not be.

### Authority: advisory by default

`authorizeAction()` now intersects the legacy decision with the contract's. Governance layers compose by intersection, never union: a second opinion may refuse what the first permitted, but must never permit what the first refused.

It runs in **advisory** mode by default — the derived tier and any disagreement are recorded on `AuthorizationResult` (`contractTier`, `contractRationale`, `contractDisagreement`) and the legacy decision still governs. Flipping straight to enforcing would refuse work the system does today on the strength of metadata nobody has checked against reality. Run advisory, read the disagreements off real cycles, then:

```bash
HEIDI_CONTRACT_AUTHORITY=enforcing
```

### Migrated capabilities

`goal.advance`, `goal.complete`, `tool.create_task`, `recovery.governed_recover`, `recovery.auto_recover`, `comm.send_message`, `revenue.run_cycle`, `revenue.identify_prospect`, `revenue.update_prospect_status`, `revenue.create_opportunity`, `revenue.activate_service`, `revenue.get_verified_revenue`, `world.query`, `cognitive.observe`.

`core.contractCoverage()` reports which capabilities verify from a contract, which still fall through to the legacy chain, and which have no observer:

```bash
npm run capability:coverage
# authority mode:      advisory
# contract-verified:   14
# legacy if-chain:     28
```

### Debt this migration made visible rather than fixed

Five contracts verify against `api_response` — the executor marking its own homework: `comm.send_message`, `revenue.run_cycle`, `revenue.get_verified_revenue`, `world.query`, `cognitive.observe`. The legacy chain did exactly the same thing; the difference is that `weaklyVerified()` now lists them. `world.query` is the one honest case (the response *is* the outcome). The other four should read a durable record instead.

Also carried over: `recovery.*` treats `checkHealth()` resolving as healthy. It does not assert the *specific recovered component* is healthy — only that the health subsystem answered. Recorded in the contract's `verificationCaveat`.

### Test status after migration

| suite | result |
|---|---|
| `capability-contract` | 51/51 |
| `cognitive-core-contracts` | 21/21 |
| `heidi-cognitive-core` | 53/53 |
| `heidi-cognitive-core-qualification` | 10/10 |
| `autonomy-contract`, `autonomy-boundary` | pass |
| `heidi-cognitive-loop-qualification` | **6/14 — 8 pre-existing timeouts, see below** |

`heidi-cognitive-core-qualification` TEST 4 needed one update: it asserted `verificationStrategy` contained the legacy prose `"actions table"`. The substantive assertions passed — the contract path really did re-read `actions` and find the row. The test now asserts that from the evidence (`observed.table === 'actions'`, `observed.found === true`), which is stronger than the substring it replaced. `verificationStrategy` was also enriched to name the observed target, not just the source type.

### A pre-existing hang this work surfaced

`heidi-cognitive-loop-qualification` fails 8 of 14 tests, all by timeout at ~120000ms. **This reproduces identically on unmodified code** — confirmed by stashing the migration and re-running the full 1000s suite. It is not a regression.

The stack points at `lib/heidi/ExecutionBridgeAdapters.ts:63` → `storeExperience` → `CognitiveCore.learnFromCycle`. Every cycle awaits an embeddings-backed memory write with no timeout, so a slow local model stalls the whole loop. TEST D is bare `await core.runCycle()` and still times out.

A bounded cognitive loop that can block forever on a memory write is not bounded. Tracked separately; the fix is a timeout in `learnFromCycle`, not a larger test budget.

## 5. Full migration (43/43)

`npm run capability:coverage` now reports **43 contract-verified, 0 on the legacy chain.**

The remaining 28 were split by a distinction that drives every choice in `lib/heidi/contracts/extended-contracts.ts`:

> `api_response` verification is honest for a **read** and dishonest for a **write**.

A read returns data; there is nowhere else to look, so checking what came back *is* the verification. A write leaves a durable record, and checking only the response means asking the thing that did the work whether it worked. Eighteen reads use `api_response` without apology; the writers read their record back out of Postgres.

`weaklyVerifiedWrites()` therefore returns **4**, not 18 — lumping the reads in would have buried the real cases:

- `comm.send_message`, `tool.send_email` — provider acceptance, not delivery
- `revenue.run_cycle` — shape check on the return value, not a read of what it wrote
- `self_sufficiency.run_self_repair` — the engine reported evidence; nobody re-probed the repaired capabilities

### Tier distribution (unattended)

| tier | count | character |
|---|---|---|
| R0 | 22 | reads |
| R2 | 9 | reversible writes |
| R3 | 7 | creates with no registered undo |
| R4 | 5 | external, customer-visible, or system-affecting |

### The if-chain is gone

`verifyAction()` went from ~270 lines of `if (capabilityId === …)` to 42 lines that contain no capability-specific knowledge. That chain was the ceiling identified in section 1 — every new capability required editing the planner. It no longer exists.

Its default also changed, and this is the more important half. The old fallback was:

```ts
return { verified: exec.outcome === 'success', ... }   // trust the executor
```

The new one reports `unverified` and names the uncontracted capability. A capability reaching that path has no contract; that is a gap to close, not evidence of success. It is unreachable for all 43 registered capabilities today, and `contractCoverage().legacyFallback` lists anything that lands there.

### New observation target

`count:<table>` was added to the database observer for `world.sync`, whose effect is "there are now rows" rather than "this row exists". A sync writing an unknown number of entities cannot be verified by id, but an empty world model after a sync is unambiguously a failure. That removed the last write that would otherwise have needed response-shaped verification.

## 6. What is NOT done

**`filesystem`, `http_probe`, `camera` and `sensor` observers are not implemented.** Only `database`, `api_response` and `process` exist. `registry.unobservable()` lists what is missing.

**No interlock probes exist.** `FDM_PRINT_INTERLOCKS` describes what must be true. Nothing in this repo reads a thermal fuse or a smoke relay, and no such hardware is known to be installed. Until it is, `protoforge.print_job` correctly resolves to R5.

### Suggested order

1. Run the loop in advisory mode and collect `contractDisagreement` values off real cycles. That is the evidence needed to flip `HEIDI_CONTRACT_AUTHORITY=enforcing` without guessing.
2. Replace the four dishonest `api_response` verifications with reads of durable records.
3. Narrow `recovery.*` verification to the specific component, not "the health subsystem answered".
4. Write contracts for the remaining 28 capabilities; delete legacy branches as they land.
5. Register the existing recovery flows as playbooks; run `assess()` and read the escalations before trusting any of them unattended.
6. Physical interlocks before any unattended print. Not after.
