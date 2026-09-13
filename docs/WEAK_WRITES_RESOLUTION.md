# The four weak writes — resolved individually

**Date:** 2026-09-08

Four capabilities mutated state but verified only against the executor's own return value. Each got a different answer, because each has a different authoritative outcome. Collapsing them into "success" is precisely what this exercise was meant to stop.

The distinctions kept separate throughout:

| class | meaning |
|---|---|
| `independent` | re-read from a durable record or a subsystem that did not perform the action |
| `provider_acceptance` | a third party acknowledged receipt — stronger than self-report, weaker than delivery |
| `orchestrated` | the durable effects are produced and verified by the capabilities it invokes |
| `unverifiable` | no automatable check exists; requires human confirmation |

---

## 1. `comm.send_message` → **independent**

**Actual outcome:** a message row in `chat_messages` with a delivery status written asynchronously by the channel adapter.

**Authoritative source:** `CommunicationLayer.verifyDelivery(messageId)` — it already existed, reading the durable conversation store rather than the send path's return value. It was simply never wired to verification.

Now observed via `process` → `delivery:{messageId}`, `settleMs: 1000`, condition `status matches ^(delivered|sent)$`.

**Environment blocker, recorded not worked around.** `conversationStore.getMessage()` selects `message_id`, which does not exist in this database:

```
chat_messages: id, conversation_id, sender_type, content, tool_call, created_at
```

No `message_id`, no `delivery_status`. The independent path is implemented and will report `error` here until that drift is resolved. **That is the correct failure.** Falling back to the transport's self-report because the real check is broken would reintroduce exactly the defect being removed.

---

## 2. `tool.send_email` → **provider_acceptance**

**Actual outcome:** Resend accepted the message and issued an id. HYDI writes no durable record of the send.

**A real defect was found here.** The contract's predicate checked field `id`, but `ActionExecutor.sendEmail` returns `{ email_id, to }`. The condition could never match, so this capability would have reported **verification failure on every successful send**. Fixed to `email_id`.

That bug survived static review and was caught only by inspecting the executor against the contract — which is the argument for Phase 2 existing at all.

**Deliberately not upgraded to `independent`.** Resend exposes `GET /emails/{id}` with a delivery status; querying it post-send would be genuine independent verification. It needs an `http_probe` observer and a configured `RESEND_API_KEY`, neither of which exists here. Recorded as `upgradePath` rather than built speculatively.

**What this does NOT claim:** that the email arrived. Provider acceptance means a third party took responsibility for it.

---

## 3. `revenue.run_cycle` → **orchestrated**

**Actual outcome:** none of its own. `RevenueControlLoop.run()` collects metrics, identifies actions, and dispatches. Its durable effects are produced by `revenue.identify_prospect`, `revenue.update_prospect_status`, `revenue.create_opportunity` and `revenue.activate_service` — each independently verified against its own table.

So there is no separate record to read, and a response-shape check is the correct scope for the orchestrator itself. Verification lives one level down, where the writes are.

**Discrepancy worth reconciling:** the file header claims step 7 "Records evidence in `revenue_events`", but no such write exists in `RevenueControlLoop`. Either the comment is stale or the write was lost. Flagged, not silently accepted.

---

## 4. `self_sufficiency.run_self_repair` → **unverifiable**

**Actual outcome:** composite and, as currently modelled, genuinely not independently observable.

A repair run both repairs capabilities and *correctly escalates* others for human authorization. Re-probing health afterwards cannot distinguish those two:

- a still-blocked capability may mean the repair failed, **or** that the engine correctly declined to act on an R2+ change
- any predicate strict enough to catch the first would fail the second

`sre.getHistory()` is not a way out — that is the same engine reporting on itself through a different accessor, which is not independence.

Rather than manufacture a predicate, this is marked `requiresHumanConfirmation: true` — the contract's existing lever for "cannot be automated". That forces R3 minimum, so it can never run unattended on the strength of a shape check.

**What would fix it:** a health model that records REPAIRED vs ESCALATED per capability, so a post-repair probe could assert "nothing the engine claimed to repair was left blocked."

---

## Result

`weaklyVerifiedWrites()` went from **4 → 3**, and the one that left did so by gaining a real observation source, not by being reclassified.

The remaining three are each explicitly classified with the reason and, where one exists, the upgrade path. None of them silently reports the executor's success as verification.
