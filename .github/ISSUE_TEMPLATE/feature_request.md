---
name: Feature Request
about: Propose a new capability
title: '[FEAT] '
labels: enhancement
assignees: ''
---

## Problem this solves
<!-- What limitation or gap does this address? -->

## Proposed solution
<!-- How should this work? -->

## Subsystem affected
- [ ] Ingestion Layer
- [ ] RAW EVENT LEDGER
- [ ] CASCADE (classifier)
- [ ] KILO (hypothesis generator)
- [ ] ProtoForge (policy engine / DSL)
- [ ] Emission Layer
- [ ] Replay Engine
- [ ] PAO System agents (`pao-system/agents/`)
- [ ] API Layer (`api/`)
- [ ] Supabase Edge Functions
- [ ] Revenue Engine
- [ ] Workers (`workers/`)
- [ ] Frontend (`pages/`, `components/`)
- [ ] Config / Infrastructure

## Pipeline constraint check
<!-- Confirm this feature preserves the six-layer constraint: each layer does exactly one job -->
- Does this change what CASCADE outputs? It must remain `{ classification, confidence, matched_rules }` only.
- Does this give KILO any execution authority? `execute()` must remain unconditionally throwing.
- Does this add logic to the Emission Layer? It must remain zero-logic (SSE / API / logs only).
- Does the PolicyEngine default remain `'reject'` (fail-closed)?

## Acceptance criteria
- [ ] 
- [ ] 
- [ ] 

## Alternatives considered
<!-- Any other approaches you ruled out? -->
