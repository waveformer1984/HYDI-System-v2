# HYDI Phase 7B — ProtoForge Policy Readiness

## Summary

ProtoForge policy engine now operates without Supabase when `HYDI_POLICY_SOURCE=local` or when cloud credentials are absent. Supabase remains supported for cloud deployments.

## What was migrated

- `lib/protoforge/policy-engine.js` — now accepts a `PolicyStore` abstraction (`SupabasePolicyStore` or `LocalPolicyStore`).
- `lib/protoforge/stores/local-policy-store.js` — new local JSON store.
- `lib/protoforge/stores/supabase-policy-store.js` — extracted Supabase behavior.
- `data/hydi-local/protoforge/policies.json` — local policy configuration.
- `data/hydi-local/protoforge/decisions.json` — local decision audit.
- `tests/unit/protoforge-policy-local.test.js` — 7/7 PASS.

## Verification

```text
npm run typecheck                                              PASS
npm run build                                                  PASS
npm run validate:rezonate-contract                             PASS
npx jest tests/unit/protoforge-policy-engine.test.js          43/43 PASS
npx jest tests/unit/protoforge-policy-local.test.js           7/7 PASS
```

## Failure modes

| Scenario | Behavior |
|---|---|
| No `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Uses `LocalPolicyStore`. |
| `HYDI_POLICY_SOURCE=local` | Forces local store even if cloud env is present. |
| Missing `policies.json` | `evaluate()` returns `reject` with `no-active-policy` reasoning. |
| Corrupt `policies.json` | Logs warning; `evaluate()` returns `reject`. |
| Missing `decisions.json` | Created on first `recordDecision`. |

## Authorization

- Policy evaluation is read-only and stateless; no RBAC bypass introduced.
- Local policy files are read from `data/hydi-local/protoforge/`. Write access to this directory is governed by the operating system; no additional permission system added.

## Limitations

- Policy configuration is still edited manually or via external tools; no local-first policy admin UI yet.
- `lib/protoforge/auto-gate.js` escalation queue to `actions` table remains cloud-only; it logs a warning when cloud is unavailable.

## Verdict

**ProtoForge policy: GO** for local-first operation.
