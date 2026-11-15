# PR #593 / #594 merge-readiness report

**Generated:** 2026-11-15 (Cloud Agent Mission 2)  
**Operator action:** review only — **do not auto-merge** (preserve stack order: #593 → #594).

## Stack topology

| PR | Branch | Base | HEAD (at audit) | Role |
|----|--------|------|-----------------|------|
| [#593](https://github.com/waveformer1984/HYDI-System-v2/pull/593) | `Cusor_agent01partnerships-funding-7718` | `clean-main` | `ec7e6c387929ae6ae93814e13c406e87bcd31aa6` | Partnerships Resource Acquisition Engine v1 + security hardening |
| [#594](https://github.com/waveformer1984/HYDI-System-v2/pull/594) | `Cusor_agent01resource-acquisition-master-7718` | **#593 branch** | `736346c2` (+ Mission 2 commits pending push) | Master discovery, actions, dashboard, scheduling hooks |

GitHub reports both PRs **mergeable** (#593 `mergeable_state: clean`, #594 `unstable` until CI completes on new commits).

## Shared / conflict surface

- **Merge #594 into #593 base:** no textual conflicts on merge-tree snapshot (additive files under `lib/resource-acquisition/`, docs, scripts).
- **Merge #593 into `clean-main`:** additive partnership module (`lib/partnerships-funding/**`), mobile BFF, fixtures, tests — no overlapping edits to pipeline layers 1–6.
- **Overlap risk after #593 lands:** any concurrent edits to `pages/api/heidi-mobile/partnerships.js` on `clean-main` would need a routine rebase of #594 onto updated #593 head.

## Tests executed (local, this environment)

### At partnerships HEAD (`ec7e6c38` semantics — branch checked out includes #593 + #594 + Mission 2 work)

```bash
npm run typecheck   # PASS
npx jest tests/unit/partnerships-funding.test.js tests/unit/resource-acquisition-engine.test.js \
  tests/unit/partnerships-acquisition-guards.test.js tests/unit/resource-acquisition-actions.test.js \
  tests/unit/resource-acquisition-discovery.test.js tests/unit/heidi-resource-capabilities.test.js \
  tests/unit/resource-verification.test.js tests/unit/profile-validator.test.js --runInBand --forceExit
# PASS (36 tests across suites)
npx jest tests/integration/resource-acquisition-fabric.test.js --testMatch="**/*.test.js" --runInBand --forceExit
# PASS
```

### CI posture (GitHub API at audit time)

- #593 `ec7e6c38`: combined status **pending** (no failing contexts returned in API snapshot).
- #594 `736346c2`: combined status **pending** before Mission 2 push; re-run after operationalization commit.

## Merge order (mandatory)

1. Merge **#593** to `clean-main` after operator review (security gates, profile path, operator auth).
2. Rebase **#594** onto updated `Cusor_agent01partnerships-funding-7718` or `clean-main` if #593 was squash-merged.
3. Merge **#594** only after #593 is on trunk.

## Human approvals before production

- `HYDI_ORG_PROFILE_PATH` with `approved_by_owner` (never commit profile JSON).
- `HYDI_PARTNERSHIPS_OPERATOR_SECRET` (or documented operator auth path) for submit/award.
- `HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY=1` to activate scheduler child (default **off**).
- Frank/Windows: no scheduled task without explicit operator authorization.

## Recommendation

**MERGE-READY (engineering)** for stacked integration pending:

- Green local test matrix above on the combined branch.
- CI completion on the post–Mission 2 commit.
- Operator sign-off on #593 security review items (`docs/partnerships/PR593_SECURITY_REVIEW.md`).