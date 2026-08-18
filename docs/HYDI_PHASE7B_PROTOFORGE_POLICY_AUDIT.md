# HYDI Phase 7B — ProtoForge Policy Audit

## Data flow

```
KILO / caller
      ↓
autoGate()  ← lib/protoforge/auto-gate.js
      ↓
getPolicyEngine(stream)  ← lib/protoforge/policy-engine.js
      ↓
PolicyEngine.init(stream)
      ↓
PolicyStore.loadPolicy(stream)
      ↓
Supabase → `policies` table (cloud)
      OR
LocalPolicyStore → data/hydi-local/protoforge/policies.json (local)
      ↓
PolicyEngine.evaluate(hypothesis)
      ↓
PolicyStore.recordDecision(decision)
      ↓
Supabase → `decisions` table
      OR
LocalPolicyStore → data/hydi-local/protoforge/decisions.json
      ↓
Decision (approve/reject/escalate)
```

## Supabase usage in policy engine

| Operation | Table/View/RPC | Purpose | Class | Cloud dependency |
|---|---|---|---|---|
| `_loadPolicy` | `policies` (read) | Load active policy for stream/global | A. static config | Read path |
| `recordDecision` | `decisions` (insert) | Audit decision | D. audit/event | Write path |
| `recordOutcome` | `decisions` (update) | Backfill execution outcome | D. audit/event | Write path |
| `_subscribeRealtime` | Supabase Realtime | Hot-reload on `policies` changes | A. static config | Optional enhancement |

## Classification of data

| Datum | Class | Notes |
|---|---|---|
| `policies` rows | A. static configuration | Rules are versioned configuration; tenant-scoped optional |
| `decisions` rows | D. audit/event state | Immutable decision record, plus optional outcome backfill |
| `actions` (escalation queue) | C. user/tenant-scoped state | Written by `auto-gate.js`; out of scope for 7B engine, remains DEGRADED |

## Key observations

1. Rules are read-mostly, versioned configuration. A JSON file in `data/hydi-local/protoforge/policies.json` is sufficient for local-first operation.
2. Decisions are audit state. A local JSON object file (`decisions.json`) keyed by decision UUID supports both `recordDecision` and `recordOutcome` updates.
3. Hot-reload via Supabase Realtime is a convenience, not a core requirement. Local file can be loaded on `init`; an `onReload` no-op is acceptable for local-first.
4. `auto-gate.js` escalation queue to `actions` table is a separate, later migration. The policy engine itself does not depend on it.
