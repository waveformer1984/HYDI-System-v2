# HYDI Changelog

## [Unreleased]

### Fixed

- **Workers reported unhandled events as successfully completed tasks.** All
  ten dispatching workers logged an unrecognised `event_type` at info level
  and then called `completeTask(taskId, true)`, so misrouted or unimplemented
  events vanished with a success signal and no failure record — most
  consequentially in `RevenueIngestionWorker`, where that means revenue data
  disappearing without trace. Unhandled events now throw into each worker's
  existing failure path, which requeues to `max_attempts` and then marks the
  task `failed` — bounded and visible.
- **Cost analytics ignored the requested `time_period`.**
  `CostMarginWorker.generateCostAnalytics()` stored the requested period on
  the `cost_analytics` row it inserts while always querying a hardcoded 30
  days, so a request for a week returned a month of revenue and cost filed
  under `'week'`. Now resolves the real window.
- Unified the `time_period` vocabulary (`today | yesterday | week | month`)
  into `workers/time-period.js`. It previously existed as two drifted copies,
  only one of which understood `yesterday` — so a behaviour-analysis request
  for yesterday silently returned 30 days.
- **Inventory low-stock alerting never fired.** `InventoryMaterialsWorker`
  (registered in `WorkerOrchestrator`, polling every 30s) split low-stock items
  into critical/warning by reading `item.quantity`, but `inventory_items` rows
  store quantity in `quantity_count`/`quantity_grams`/`quantity_ml` and have no
  such column. Both filters compared `undefined`, both were always empty, and
  no inventory notification was ever enqueued — including for stock at zero.
  The same bug meant out-of-stock items were procured at `high` rather than
  `critical` urgency (72h expected delivery instead of 24h). Both call sites
  now use a shared `normalizeQuantity()` helper.
- **`fastener_*` inventory was never monitored.** One of the five item-type
  families in the canonical taxonomy matched no branch in the low-stock
  threshold chain, so screws, nuts and bolts could run to zero without raising
  an alert or triggering procurement. Added a `fasteners_count` threshold and
  the missing branch.
- Consolidated the low-stock threshold chain, which existed as two drifted
  copies in `identifyLowStock` and `getLowStockItems` (only one honoured
  caller-supplied overrides), into a single `isLowStock()` predicate. Also
  fixed override handling: the previous `||` fallback discarded a legitimate
  threshold of `0` and silently applied the default.
- `tests/unit/hydi-v3/HardwareDiscovery.test.js`'s Windows-fallback test asserted
  behavior specific to `os.platform() === 'win32'` without mocking `platform()`,
  so on any non-Windows CI runner (`unit-tests.yml` runs on `ubuntu-latest`) it
  exercised the Linux `lspci` fallback path instead and always failed. Latent
  since the test was added; now mocks `os.platform()` so the assertion is
  deterministic on every host.
- `tests/unit/hydi-v3/{HeartbeatSystem,DistributedCompute,WatchdogSupervisor}.test.js`'s
  timer-driven tests raced a fixed sleep against each engine's own internal
  interval timer, flaking under full-suite parallel load. Now await the real
  `EventEmitter` event instead.

### Added

- `edge-functions.yml` CI workflow and `npm run test:edge`, so the Deno Edge
  Function tests actually execute. The 45 Edge Functions sit outside the
  Jest/tsc pipeline entirely, and nothing in CI ran Deno — meaning
  `_shared/security.ts`, the module gating ~30 functions, had a test file that
  had never once run. Scoped to the hermetic `_shared/` suite; the other
  functions import from esm.sh/deno.land at load, so type-checking them needs
  network egress.
- Test coverage for `InventoryMaterialsWorker` (28 tests) and
  `revenue-engine-v2`'s `executeTask()` (14 tests, covering all four exits).
  Both files previously had none — the gap flagged in `ISSUES_FOUND.md` #74.
  Both suites were verified to fail against the pre-fix code.
- `workers/inventory-taxonomy.js` and `workers/time-period.js` — single
  definitions for two vocabularies that were previously duplicated across
  workers. The inventory duplication is what let the fastener monitoring gap
  survive: both copies of the optimal-levels table listed `fastener_*` while
  the threshold chain had no branch for it. Their tests assert cross-worker
  consistency, so that class of gap now fails CI rather than silently not
  alerting.
- 32-test contract suite asserting no worker can report an unhandled event as
  a completed task, and 20 tests for period resolution against a frozen
  clock.

### Security

- **Bounded the Edge Function rate limiter's memory.** Bucket keys derive from
  the caller-influenced `x-forwarded-for` header and nothing ever evicted, so
  a caller could mint unlimited buckets — making the module meant to absorb
  floods a memory-exhaustion vector itself. Expired buckets are now swept on
  the request path (time- and size-triggered) under a hard ceiling. Its Node
  twin `lib/rate-limit.js` already guarded this; the sweep was never carried
  across.
- **Constant-time comparison of the service-role key** in
  `requireServiceRole()`. `!==` short-circuits at the first differing byte,
  leaking guessed-prefix length through response timing. Defense-in-depth
  rather than a known-exploitable hole, but it guards every privileged Edge
  Function.
- **Resolved the outstanding high-severity `brace-expansion` DoS advisories**
  (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895). `npm audit` now reports 0
  vulnerabilities. The scoped `minimatch` override had pinned
  `brace-expansion` to exactly `5.0.7` — itself inside the vulnerable range —
  and was never advanced as the advisory widened. Bumped to `^5.0.9` and the
  selector widened to `minimatch@^10` so a future patch bump can't silently
  drop the override. This supersedes the "no non-forced resolution path"
  conclusion below: that was true of a *global* pin (which breaks `next lint`,
  since `minimatch@3` needs the v1 API), not of a scoped one.
- **Archived two unhardened duplicates of the `chat-operator` handler.**
  `chat-operator` issues refunds; the live `index.ts` carries a
  session-ownership check (without which a client-supplied `user_id` allows
  acting as another user) and rate limiting, and neither sibling had either.
  Moved to `archive/dead-chat-operator-prototypes/`, and
  `chat-operator-blueprint-summary.md` — which pointed implementers at the
  unhardened `index-new.ts` and credited it with ownership verification it
  does not implement — now points at `index.ts`.

- Patched `ip-address` (SSRF/trust-boundary bypass advisories, a transitive
  dependency of the production `express-rate-limit` package used across every
  rate-limited route) and `undici` via `npm audit fix`. `package.json` version
  ranges unchanged; only lockfile resolutions moved. The remaining
  `brace-expansion` advisory (transitive via `@typescript-eslint/*`, dev
  tooling only) is left unresolved — forcing it via an `overrides` pin
  previously broke `next lint` (`ISSUES_FOUND.md` #2) and npm has no
  non-breaking resolution path for it yet.

## [0.9.0-rc.1] — Release Candidate

### Added

- ArchitectureGuard with 10 executable invariants (100% score)
- ServiceContract coverage across all public subsystems
- Automated plugin permission verification
- SoakHarness for long-duration stability testing
- ResourceAuditor for memory, handle and listener leak detection
- PerformanceBaseline capture and regression comparison
- DeterminismGuard for output stability validation
- Release documentation: operator runbook, disaster recovery, performance baseline, known limitations

### Changed

- `CapabilityBroker` and `FederationGateway` now expose versioned service contracts
- `InvariantRegistry` includes runtime `CapabilitySandbox` permission validation
- Package version moved to `0.9.0-rc.1`

## [0.9.0-rc.2] — Release Candidate 2

### Added

- `scripts/op-validation.js` for reproducible soak and performance baseline capture
- `FederationReplay` tests for duplicate/expired message handling
- RC2 validation reports: `RC2_24H_SOAK_REPORT.md`, `CLEAN_DEPLOYMENT_REPORT.md`, `RC2_GO_NO_GO_REPORT.md`

### Security

- `FederationGateway` now enforces message `id`, `timestamp`, `expiresAt` and a replay window
- Duplicate federation messages are rejected and audited
- Expired federation messages are rejected and audited

### Changed

- `SECURITY_REVIEW.md` updated to reflect resolved replay hardening
- Package version moved to `0.9.0-rc.2`

### Release Candidate Freeze

- All new feature phases are suspended for this release line
- Only bug fixes, security, reliability and documentation changes permitted

## [0.9.0-rc.3] — Release Candidate 3

### Security

- `SignatureVerifier` now performs real Ed25519 signing/verification against publisher public keys
- `computeDigest()` uses recursive canonical serialization so digests bind to nested `requiredPermissions` and `dependencies`
- Forged signatures and altered post-signing capabilities are rejected

### Changed

- `scripts/phase40-acceptance.js` generates and registers a real publisher keypair
- `SECURITY_REVIEW.md` and `RC2_GO_NO_GO_REPORT.md` corrected to document the finding and resolution
- Package version moved to `0.9.0-rc.3`

### Notes

- `v0.9.0-rc.3` supersedes `v0.9.0-rc.2` because `c8aaaaa` adds a security fix not present at the `v0.9.0-rc.2` tag
- 24-hour soak and clean-machine deployment must be re-run against this release candidate
