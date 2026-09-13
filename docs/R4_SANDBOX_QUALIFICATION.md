# R4 sandbox & enforcement qualification

**Date:** 2026-09-08
**Source of truth:** `lib/heidi/contracts/exercise-safety.ts` — classification lives as data, not as a constant inside the harness, so this document and the harness cannot drift.

---

## The gate this phase answers

Not *"are all 45 contracts tested?"* but:

> **Can every capability that enforcement could authorize be classified with an explicit, evidence-backed verification boundary?**

That permits a legitimate state where categories are unequal and named, rather than a single number that hides the difference.

## Taxonomy

| classification | meaning |
|---|---|
| `LIVE_SAFE_TO_EXERCISE` | no meaningful external consequence |
| `SANDBOX_REQUIRED` | needs a controlled substitute — **whether one exists is recorded separately** |
| `PROHIBITED` | must never be exercised automatically, at any tier |

"Needs a sandbox" and "has no sandbox" are different states. Collapsing them would hide the only actionable distinction.

---

## The R4 surface

| capability | classification | sandbox | status |
|---|---|---|---|
| `revenue.activate_service` | SANDBOX_REQUIRED | synthetic `customer_services` row | **executes; verification sandbox-limited** |
| `revenue.start_onboarding` | SANDBOX_REQUIRED | synthetic customer + real offer id | **VALIDATED** |
| `comm.send_message` | SANDBOX_REQUIRED | **none** — every reachable channel is external | blocked |
| `tool.send_email` | SANDBOX_REQUIRED | **none available** | blocked |
| `revenue.run_cycle` | PROHIBITED | — | permanent |
| `self_sufficiency.run_self_repair` | PROHIBITED | — | permanent |

### `revenue.activate_service` — the interesting one

`CustomerLifecycle.activateService()` is a **pure UPDATE** on `customer_services` plus an event row. It makes no Stripe call; `stripe_customer_id` / `stripe_subscription_id` are stored columns, never invoked. So a synthetic row is a complete sandbox with no commercial consequence.

It executes cleanly and **verification still fails** — correctly. The contract verifies via `verifyService()`, which returns `verified: false` while fulfillment steps are incomplete, and a synthetic service has never completed any.

This is a **third outcome**, distinct from both a contract defect and a harness defect: the predicate is right, the fixture is right, and the check fails because a synthetic substitute is not the real thing. It is recorded as `SANDBOX_LIMITED` in both the harness and the matrix. Loosening the predicate to make it pass would destroy the only property worth having.

Full validation needs a sandbox that completes fulfillment and exposes a health endpoint — not a weaker check.

### `comm.send_message` — two of my own claims retracted

I first classified `heidi_core` as a local sandbox, reasoning from `ChannelId` that some channels are local and some external. **Attempting the exercise refuted it.** The `sendMessage` dispatch explicitly refuses chat channels:

```
Channel heidi_core uses chat(), not sendMessage()
```

Its switch handles only `email`, `sms` and `notification` — all external. **No sandbox exists.**

That also retracts the "modelling gap" I claimed: I had called the contract's unconditional `crossesTrustBoundary: true` over-broad. It is not. For this capability every reachable channel is external, so the unconditional declaration is exactly right.

Both errors came from reasoning about the type taxonomy instead of reading the dispatch. The harness caught both by trying.

**Delivery verification is now unblocked** — see below — so the sole remaining blocker is the absence of a non-external recipient.

### The two permanent prohibitions

**`self_sufficiency.run_self_repair`** — two independent reasons, either sufficient. Its effects are real service mutations with no disposable substitute; and its verification is explicitly `unverifiable`, so a harness could not detect a failed repair even if it ran one. Exercising an operation whose failure is undetectable produces no evidence.

**`revenue.run_cycle`** — it selects its own actions from live pipeline state, so a harness cannot bound what it will do. Its six constituent writes are each individually contracted and governed since the bypass fix, and those are the right unit of exercise. Running the composite adds no evidence the parts do not already provide, at far higher risk.

**`recovery.governed_recover` / `recovery.auto_recover`** (R2) are also prohibited: `RESTARTABLE_MODULES` covers `protoforge-core`, `heidi-web`, `supabase_*` and `ollama` — the processes the qualification run itself depends on. A harness that restarts its own database is not measuring the system, it is becoming the incident.

---

## `chat_messages` drift — fixed, and it hid a second defect

Two independent faults, the first masking the second.

**1. An unapplied migration, not a code/schema mismatch.** `supabase/migrations/20260819140000_communication_layer_schema.sql` adds `message_id`, `delivery_status`, `provider_message_id`, `delivered_at` and more — exactly what `conversationStore` selects. It had never been applied here. The ledger holds **3** entries while the repo has migrations through August, so this database was provisioned outside the migration history; a reset or replaying the whole history was not an option.

Applied as a single transaction with `ON_ERROR_STOP`. All statements are `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` + re-add — no `DROP TABLE/COLUMN`, no `DELETE`, no `TRUNCATE`. Row counts before and after: `chat_messages=0`, `chat_conversations=0`, unchanged. No new migration was written, so the governance gate's per-migration test rule does not apply.

**2. A uuid/text comparison that threw on every real lookup.** With the columns present, `getMessage()` still failed:

```sql
WHERE message_id = $1 OR id = $1     -- id is uuid, message_id is text
```

`CommunicationLayer` generates ids like `out-1757…-a1b2`, never UUIDs, so Postgres rejected the whole query and `getMessage()` **threw instead of returning null** — indistinguishable from the subsystem being down. Fixed with `id::text = $1`, which preserves the uuid lookup without parsing the parameter.

Worth recording precisely: the diagnostic differs by how the value arrives. A literal in `psql` gives `invalid input syntax for type uuid`; a **bound parameter** — what the store actually uses — gives `operator does not exist: uuid = text`. Same defect, different message; the regression test asserts the real code path's.

Covered by `tests/unit/conversation-store-message-lookup.test.ts` (5 tests), which runs against the real local Postgres because the defect was in the SQL itself — a mocked pool would have passed throughout. One test deliberately asserts the *pre-fix* query still fails, so the cast cannot be "simplified" back out.

## Correction: the first pass was too conservative

The harness initially marked ten capabilities UNSAFE from their **descriptions**. Reading the **implementations** changed four:

- `revenue.activate_service`, `revenue.start_onboarding`, `revenue.start_provisioning` — pure database writes, no Stripe call
- `commercial.prepare_outreach` — explicitly never sends; it produces a draft

Over-conservatism is the safe direction but it is not free: it reported capabilities as unqualifiable when they were merely un-fixtured, which misdirects the next phase of work. `UNSAFE to automate` fell from 10 → 5.

## The qualification rule, now enforced

> A failed exercise cannot be classified as a contract failure until execution, fixture validity, and harness integrity have been independently established.

Encoded rather than documented:

- execution failure **short-circuits verification** — an executor refusal can no longer surface as a verification failure
- `SANDBOX_LIMITED` separates a correct refusal from a defect, in both the harness and the matrix
- fixture-dependent capabilities are `NEEDS_FIXTURE`, never run with `{}` and reported as failures
- prerequisites that did not run cascade-skip their dependents

This mattered: of the five issues the harness surfaced, **one** was a genuine contract defect (`ops.check_health` checked a `status` field on what is a string union) and four were harness defects.

## Typecheck boundary

`tsconfig.json` excludes `scripts` and `tests` wholesale, so the qualification machinery was never compiler-checked — which is how a syntax error in the harness reached runtime. Including all of `scripts/` is not the fix: it holds 114 pre-existing errors, so the gate would fail on day one and be ignored.

```
production      npm run typecheck              lib/, src/    → clean
qualification   npm run typecheck:qualification capability-* → clean
legacy scripts  excluded, tracked separately   114 errors
```

---

## Current state

| | count |
|---|---|
| contracted | 45 |
| VALIDATED | **22** |
| SANDBOX_LIMITED | 1 |
| FAILED | 0 |
| NOT_EXERCISED | 22 |

Of the 22 not exercised: 5 PROHIBITED (permanent, with rationale), 11 need deliberate fixtures, 5 have no wired executor in this environment, 1 blocked by a prerequisite.

**Verdict remains `ADVISORY_REQUIRED`.** `HEIDI_CONTRACT_AUTHORITY` unchanged.

Every non-validated capability now carries an explicit safety classification and rationale, which was the gate's condition. What it does **not** yet have is exercise evidence for the R4 surface — two are permanently prohibited by design, and two are blocked on environment work (a Resend test key; the `chat_messages` schema drift).
