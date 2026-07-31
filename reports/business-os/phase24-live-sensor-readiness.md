# HYDI Live Sensor Readiness (Phase 24)

Scope: the Phase 18/19/23 sensing layer that observes real local activity and turns it into `BusinessSignal` objects for the Executive OS.

## Sensor inventory

| Sensor | Startup path | Configuration required | Events emitted | Interpreter | Business signals produced | Current limitations |
|---|---|---|---|---|---|---|
| **GitSensor** | Started by `OperatorSession` when `config.git` is provided (path + project). `HYDIOperationalBoot.boot()` forwards `git` from CLI flags. | `cwd` (git repository root), `project` label, optional `pollIntervalMs` (default 60s), `staleAfterMs`, `maxCommitsPerPoll`. | `CommitCreated`, `BranchCreated`, `BranchDeleted`, `WorkingTreeDirty`, `WorkingTreeClean`, `BranchStale` | `BusinessSignalInterpreter` | `BusinessSignal` with `originatingEvent`, `strategicObjective` mapped from project name, `subsystem` inferred from changed files. | Requires a working `git` executable and a real repository. A missing repo or `git` is treated as "inactive" rather than a failure, so no signals are produced. Cold-start adopts existing history as a baseline to avoid replaying the whole repo. |
| **FilesystemMonitor** | Started by `OperatorSession` when `config.filesystem` is provided. | `roots` map `{ projectName: absolutePath }`, `scanIntervalMs` (default 30s), `watch` boolean, `exclude` array. | `ProjectOpened`, `ProjectActive`, `FileCreated`, `FileModified`, `FileDeleted`, `DirectoryCreated`, `DirectoryDeleted` | `BusinessSignalInterpreter` | `BusinessSignal` for each file-system change, with `fileCategory` (source, cad-artifact, manufacturing-artifact, etc.) and `subsystem` detected from path. | `fs.watch` may be unavailable on some environments; it falls back to polling. Initial scan is a baseline, so new files created before the first scan are not reported as "created". |
| **PrinterSensor** | Started by `OperatorSession` when `config.simulateManufacturing` is true or `config.printer` is provided. | `equipmentId` (defaults to first 3d-printer in `EquipmentRegistry`), `simulate` flag, `scenario`, `autoRun`, `pollIntervalMs`, real `adapter` optional. | `PrinterStarted`, `PrinterPaused`, `PrinterResumed`, `PrinterCompleted`, `PrinterFailed`, `PrinterIdle`, `PrinterHeating`, `PrinterOffline`, `MaterialLow` | `ManufacturingSignalInterpreter` | `BusinessSignal` with `risk`/`priority` for failures and offline events, `equipmentId` and `equipmentName`. | No real USB/serial adapter is wired in. Without an adapter it is either simulation-only or idle. `PrinterSensor` requires an `EquipmentRegistry` entry or an explicit `equipmentId`. |
| **RevenueSensor** | Started by `OperatorSession` when `config.revenue` is provided. | `adapters` array (each must expose `read()`), `pollMs` (0 = one-shot). | `RevenueReceived`, `RevenueRefunded`, `InvoicePaid`, `InvoiceOverdue`, `SubscriptionStarted`, `SubscriptionCancelled` | `BusinessSignalInterpreter` | `BusinessSignal` with `strategicObjective: 'revenue'`, `amount`, `currency`, `customer`, quantitative measurement type. | Only file-based adapters (`JSONLedgerAdapter`, `CSVLedgerAdapter`) and `MockRevenueAdapter` exist. No live Stripe/payment processor polling. Duplicates are deduplicated by `id` or fingerprint. |
| **EvidenceProviders** | Registered inside `BusinessEvidenceEngine` as `providers.registerDefaults()`. Not a sensor, but the consumer that turns raw events into evidence. | None (default providers for `git`, `filesystem`, `manufacturing`, `financial`, plus generic `inventory/calendar/customer/manual`). | N/A — consumes sensor events from the event bus. | N/A — extracts evidence after the interpreter has produced a `BusinessSignal`. | `EvidenceItem` objects with `source`, `measurementType` (`activity`/`qualitative`/`quantitative`), `relevance`, `weight`, `confidence`, `tags`, `data`. | `manual` provider returns `null` by design. Providers are static maps; adding a new source requires registering a new provider. Quantitative evidence must have a finite numeric `value` or `amount` to move learning confidence. |

## Live-sensor readiness verdict

- **GitSensor** and **FilesystemMonitor** can observe a real local project directory today. They are opt-in and require explicit configuration.
- **PrinterSensor** can simulate real equipment states but cannot yet talk to physical hardware.
- **RevenueSensor** can read a real ledger file but cannot yet poll a live payment processor.
- **EvidenceProviders** are production-ready for the five configured sources, with clear rules for what counts as measured evidence.

## Blockers to full live operation

1. A real manufacturing adapter (USB/serial/Octoprint/etc.) is not implemented.
2. A live revenue adapter (Stripe webhook/Connect polling) is not implemented.
3. `ObservabilityDashboard` and `ProjectPlanner` are still stubbed, so some `missingData` warnings remain even when sensors are active.
