# END_TO_END_ACCEPTANCE

**Target lifecycle:** `queued → planning → awaiting_approval → running → verifying → completed`

## Verified in this environment (cloud VM)

| Step | Criterion | Command | Actual | Evidence |
|------|-----------|---------|--------|----------|
| Lifecycle (read-only) | Full state chain without approval | `npx jest tests/unit/mission-worker.test.js --testNamePattern=read-only` | pass | `/opt/cursor/artifacts/pov-core-unit.log` |
| Operator approval flow | Hermetic executive stack | `npx jest tests/integration/hydi-operator-approval-flow.test.js` | pass | `/opt/cursor/artifacts/pov-mobile-integration.log` |
| Verification gate | `verify()` requires evidence | `mission-output-tail.test.js` (in suite) | pass | mission-worker suite |

## Not verified here (requires Frank stack)

| Step | Criterion | Blocker |
|------|-----------|---------|
| User chat → mission queued | Real `/chat-tools` or mobile chat | heidi-core not running; no Ollama |
| Consequential action + approve | Human `task approve` on live mission | `HEIDI_MOBILE_TOKEN` / owner session |
| Independent verification on host | Post-action probe | No LIVE production-truth file |

## Safe reversible task (recommended on Frank)

Use existing **read-only** mission module (mission-worker dry run) or informational mission with `context.success` tied to a file checksum — already covered in unit tests.

**Do not** enable unrestricted `HEIDI_AUTONOMOUS_ACTIONS` for this acceptance.

## Acceptance verdict

| Scope | Verdict |
|-------|---------|
| Code path + state machine | **VERIFIED_OPERATIONAL** (automated) |
| Live operator + phone | **BLOCKED_EXTERNAL** (Frank) |