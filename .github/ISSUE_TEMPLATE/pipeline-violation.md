---
name: Pipeline Violation Report
about: A pipeline layer is performing another layer's job, or a core constraint is broken
title: '[VIOLATION] '
labels: bug, pipeline-violation
assignees: ''
---

## Which constraint is violated?

- [ ] Ingestion Layer is interpreting or classifying events (not just normalizing structure)
- [ ] CASCADE is executing actions or generating hypotheses (must classify only)
- [ ] KILO `execute()` is being called without throwing — KILO has gained execution authority
- [ ] KILO output is reaching the Emission Layer without passing through ProtoForge
- [ ] ProtoForge default decision is not `'reject'` — the policy engine is fail-open
- [ ] Emission Layer contains conditional logic or state mutations (must be zero-logic)
- [ ] RAW EVENT LEDGER has been mutated — it is no longer append-only and immutable
- [ ] Replay Engine produces different output from the same RAW LEDGER input (non-determinism / real drift)
- [ ] Cooldown window bypassed (startup window < 2 min, or drift observation < 30 s)
- [ ] Other — describe below

## Evidence

**File / line number:**

**Observed behaviour:**

**Expected behaviour (the constraint that should hold):**

## Reproduction steps
1. 
2. 
3. 

## Impact
<!-- What goes wrong as a result? False positives? Feedback loops? Revenue errors? Incorrect enforcement? -->

## Environment
- Branch / commit:
- Node version:
- Relevant logs (strip secrets before pasting):
