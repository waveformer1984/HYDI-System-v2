# PR #593 security review — fixture-backed resource acquisition

**Status:** OPEN — **do not merge** until owner completes questionnaire and accepts controls.  
**No Frank deployment or production operations authorized from this review.**

## What #593 is (and is not)

| Claim | Accurate? |
|-------|-----------|
| End-to-end workflow in code (discover → rank → draft → track hooks) | Yes — **simulated** |
| Live discovery of current program terms | **No** — bundled `tests/fixtures/partnerships/*.json` only |
| Zero new always-on agents | Yes |
| Zero spend on **new** infrastructure for this module | Yes — uses local `.runtime/partnerships-funding` store |
| Zero cost for **all** HYDI operation | **No** — existing compute, GitHub Actions, and any enabled paid APIs are unchanged |

## Findings before hardening (HEAD `2763f379`)

| Issue | Severity |
|-------|----------|
| `prepareDraft` did not require `owner_approval_record` | High |
| `recordSubmission` / `recordAward` accepted nonempty reference without operator gate | High |
| Fixtures labeled `VERIFIED_SIMULATED` / mobile `research_status` implied verification | Medium |
| Mobile loaded org profile from committed template path | Medium |
| Priority score could exceed unverified caps; `application_ready` absent | Medium |

## Controls added in review branch (pending push)

- `validateOrgProfile` requires `owner_approval_record` when `approved_by_owner`
- `prepareDraft` requires operator-verified source (`recordOperatorSourceVerification`)
- `recordSubmission` / `recordAward` require `assertOperatorAuthorization` + `evidence.operator_action`
- Fixtures: `intake_kind: example_fixture`, `source_verification_status: example_unverified`
- Mobile: `HYDI_ORG_PROFILE_PATH` only; refuses `docs/partnerships/*` as approved profile
- Snapshot: `fixture_backed`, `application_ready`, verification timestamps; benefit text hidden until verified

## Remaining gaps (do not expand scope until addressed)

| Gap | Mitigation |
|-----|------------|
| No HTTP API yet for operator writes (CLI/in-process only) | Next phase: single POST behind `HYDI_PARTNERSHIPS_OPERATOR_SECRET` + session |
| `allowTestHarness` in Jest only — must never ship enabled in production entrypoints | Env guard in production bootstrap |
| Source verification is operator attestation, not automated page fetch | Phase 2 curated intake |
| Profile file on disk is trust boundary | Owner questionnaire + private path |

## CI on prior HEAD (`2763f379`)

| Check | Result (2026-11-15) |
|-------|---------------------|
| Secrets, artifacts, change size | success |
| verify-quick | success |
| HYDI V3 Operational Integration Suite | success |
| Jest Unit Tests | in progress at review time |
| CodeQL analyze | in progress at review time |

Re-run CI after review commits land on the PR branch.

## Tests added

`tests/unit/partnerships-acquisition-guards.test.js` — profile, fixture labeling, operator auth, dedupe, mobile redaction.