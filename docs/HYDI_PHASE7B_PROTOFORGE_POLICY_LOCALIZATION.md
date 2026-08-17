# HYDI Phase 7B — ProtoForge Policy Localization

## Goal

Make `lib/protoforge/policy-engine.js` operational without cloud Supabase while preserving fail-closed semantics, auditability, and the existing public API.

## Local persistence contract

### Policy configuration

```text
data/hydi-local/protoforge/policies.json
```

Schema:

```json
{
  "policies": [
    {
      "id": "uuid",
      "version": 1,
      "name": "string",
      "description": "string",
      "rules": {
        "default": "reject",
        "rules": [
          { "id": "string", "priority": 1, "if": { ... }, "then": "approve|reject|escalate" }
        ]
      },
      "stream": "string | null",
      "is_active": true
    }
  ]
}
```

- Multiple policies can exist; at most one active per stream and one global (`stream: null`).
- `loadPolicy(stream)` returns stream-specific active policy first, then global active policy.
- No policy found returns `null` (fail-closed).
- Corrupt file returns `null` and logs warning.

### Decision audit

```text
data/hydi-local/protoforge/decisions.json
```

Schema:

```json
{
  "decisions": {
    "<uuid>": {
      "id": "uuid",
      "event_hash": "string",
      "hypothesis_id": "string",
      "policy_id": "string | null",
      "policy_version": 0,
      "decision": "approve|reject|escalate",
      "matched_rule_id": "string | null",
      "confidence": 0.9,
      "risk_score": 0.1,
      "revenue_impact": 10,
      "stream": "string | null",
      "reasoning": "string",
      "decided_at": "ISO 8601",
      "outcome": "success|failure|unknown | null",
      "outcome_at": "ISO 8601 | null",
      "outcome_detail": {}
    }
  }
}
```

- `recordDecision(row)` inserts/upserts by `id`.
- `recordOutcome(decisionId, outcome, detail)` updates existing decision by `id`.
- Corrupt file recovers to empty decisions object.

## Provider abstraction

`lib/protoforge/policy-engine.js` `PolicyEngine` accepts a `PolicyStore` instance. Two implementations:

- `SupabasePolicyStore` — existing cloud behavior (Supabase `policies` and `decisions` tables, Realtime hot-reload).
- `LocalPolicyStore` — new local JSON store.

`getPolicyEngine(stream)` chooses the store based on env:

- If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set and `HYDI_POLICY_SOURCE` is not `'local'`, use `SupabasePolicyStore`.
- Otherwise use `LocalPolicyStore`.

Cloud is never a hidden fallback. A `SupabasePolicyStore` must not be created if the policy source is set to local.

## Authorization

- Policy evaluation itself is read-only and stateless.
- Policy configuration changes are outside the scope of this phase.
- `getPolicyEngine` and `evaluate` do not bypass RBAC; any RBAC checks are the caller's responsibility.

## Failure modes

| Scenario | Behavior |
|---|---|
| `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset | Use `LocalPolicyStore`. |
| `HYDI_POLICY_SOURCE=local` | Force `LocalPolicyStore` even if cloud env vars exist. |
| `policies.json` missing | No active policy. `evaluate()` returns `reject` with `no-active-policy` reasoning. |
| `policies.json` corrupt | Warning logged; `evaluate()` returns `reject` with `no-active-policy` reasoning. |
| No matching rule | Returns default decision (`reject`). |
| `decisions.json` missing/corrupt | Starts with empty audit; decision recording returns without error. |
| `recordOutcome` for unknown id | No-op; warning logged. |

## Startup, restart, cloud behavior

- `init(stream)` loads active policy from the selected store.
- `LocalPolicyStore` loads from `policies.json` at `init`; no hot-reload.
- `SupabasePolicyStore` loads from `policies` table and subscribes to Realtime.
- `decisions.json` is loaded on demand when `recordDecision` or `recordOutcome` is called.
- Restarting the process with `policies.json` present recovers the active policy.
- Cloud unavailability does not affect local policy evaluation.

## Tests

`tests/unit/protoforge-policy-local.test.js` covers:

- local policy load
- evaluation with local policy
- allow, deny, escalate, default reject
- policy precedence
- missing policy
- malformed policy file
- persistence and process restart
- `recordDecision` and `recordOutcome` without Supabase
- no accidental cloud calls
- `getPolicyEngine` with no cloud credentials

## Remaining work

- `auto-gate.js` still queues escalations to Supabase `actions` table when cloud is present, and skips them when absent. This is not the policy engine's responsibility.
- Policy configuration management UI remains cloud-only. Local-first policy editing is out of scope.
