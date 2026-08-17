# Platform Diagnostics

## Purpose

The platform diagnostics endpoint exposes the real runtime state of every canonical and legacy component. A component can be **registered**, **loaded**, and **reachable** independently:

- **registered** — known by the platform registry
- **loaded** — source files or packages are present on disk
- **reachable** — the component can be instantiated, required, or contacted without error

```text
registered ≠ healthy
loaded ≠ reachable
```

Do not treat `loaded` as a health signal. Use `reachable` for runtime state.

## Endpoint

```bash
GET /api/platform/diagnostics
```

## Response schema

```json
{
  "ok": true,
  "last_checked": "2026-08-01T00:00:00.000Z",
  "canonical": [
    {
      "name": "HYDI Event Gateway",
      "path": "protoforge/hydi-gateway/src/index.js",
      "registered": true,
      "loaded": true,
      "reachable": true,
      "version": "0.1.0",
      "last_checked": "2026-08-01T00:00:00.000Z",
      "dependencies": [
        { "name": "RawLedgerAdapter", "path": "...", "loaded": true, "reachable": true }
      ],
      "reason": null
    }
  ],
  "legacy": [...],
  "deprecated": [...],
  "summary": {
    "canonicalReachable": 5,
    "legacyReachable": 3,
    "canonicalLoaded": 8,
    "legacyLoaded": 6,
    "total": 14
  }
}
```

## Field definitions

| Field | Meaning |
|---|---|
| `registered` | The component is catalogued in the platform registry. Always `true` for known components. |
| `loaded` | The source file or package is present and readable. Does **not** mean it is running correctly. |
| `reachable` | The component or its key class can be required, instantiated, or its health endpoint responded successfully. |
| `dependencies` | Sub-components the component depends on, with their own `loaded` and `reachable` values. |
| `last_checked` | ISO 8601 timestamp for the check. |
| `version` | Semver from the nearest `package.json`, or `present` / `missing` if unavailable. |
| `reason` | Human-readable explanation when `reachable` is `false`. |

## Runtime checks per component

| Component | Check |
|---|---|
| **HYDI Event Gateway** | Fetches `HYDI_GATEWAY_ENDPOINT/health` if `HYDI_GATEWAY_ENDPOINT` is set; otherwise instantiates `RawLedgerAdapter` with `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and calls `health()`. Also checks `Outbox` and `RetryWorker` deps. |
| **CASCADE** | Instantiates `EventProcessor` from `protoforge/cascade/src/processor.js`. Checks `LedgerAdapter`, `ReplayEngine`, `LineageGraph` dependencies. |
| **CASCADE Replay Engine** | Requires `protoforge/cascade/src/replay.js` and verifies `ReplayEngine` export. |
| **KILO** | Requires `kilo/index.js` and verifies `KiloEngine` export. |
| **ProtoForge PolicyEngine** | Requires `lib/protoforge/policy-engine.js` and verifies `PolicyEngine` export. |
| **Proto YI** | Loads `protoforge-applications/proto-yi/src/adapters/protoiy-engine.js`, confirms `ProtoIYEngineAdapter` is exportable, then calls `adapter.health()` against `PROTOIY_ENDPOINT` (default `http://localhost:5000`). Uses a 2 second timeout. `reachable` is `true` only when the Flask Proto.I.Y engine responds successfully; otherwise `reason` is `"ProtoIY engine unavailable"` (or `": <error>"` if a lower-level error is returned). |
| **ProtoForge Action Gate** | TypeScript / ESM file; currently not requireable. `loaded` is reported, `reachable` is `false`. |
| **Emission (EventBus)** | TypeScript source; `loaded` reported, `reachable` `false` until compiled or imported. |
| **Legacy modules** | `modules/cascade-*.js` and `keeper/policy-engine.js` are required. `.ts` legacy files are `loaded` but `reachable: false`. `modules/raw-event-ledger.js` is not required because it has side effects. |

## Usage

```bash
curl http://localhost:3000/api/platform/diagnostics
```

Or from Node:

```js
const { getRuntimeInventory } = require('./lib/platform-diagnostics');
const inventory = await getRuntimeInventory();
console.log(inventory.summary);
```

## Proto YI runtime probe

Proto YI is registered both as a ProtoForge application (via `ApplicationRegistry`) and as a canonical runtime component (via `CapabilityRegistry`). The diagnostics probe:

1. Confirms the `ProtoIYEngineAdapter` module can be `require()`d.
2. Instantiates a short-lived `ProtoIYEngineAdapter` pointed at `PROTOIY_ENDPOINT`.
3. Calls `adapter.health()` through the same HTTP client used by the application.
4. Reports `reachable: true` only if the Flask engine returns a successful `/health` response.

No fake `healthy` response is generated. When the engine is missing, the probe reports `reachable: false` with `reason: "ProtoIY engine unavailable"`. This keeps the ProtoForge platform from treating an idle Flask service as healthy.

## Interpretation rules

1. `reachable: true` means the component is ready for production use right now.
2. `loaded: true` but `reachable: false` means the code exists but cannot be started (missing env, ESM-only, deprecated).
3. `loaded: false` means the component is not installed or has been removed.
4. Legacy / deprecated components should have `reachable: false` in steady state.
