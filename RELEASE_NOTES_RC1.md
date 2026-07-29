# Release Notes — RC-1

## Overview

RC-1 is the first release candidate for the HYDI platform. It consolidates
Phases 34–44 and adds the ArchitectureGuard hardening layer.

## Included Phases

- Phase 34 — Local AI orchestration
- Phase 35 — Runtime intelligence
- Phase 36 — Governance & observability
- Phase 37 — Adaptive optimization
- Phase 38 — Resilience & recovery
- Phase 39 — Lifecycle operating system
- Phase 40 — Verified capability marketplace
- Phase 41 — Secure federation
- Phase 42 — Collaborative execution fabric
- Phase 43 — Executive intelligence
- Phase 44 — Production reliability & operations
- RC-1 — Architecture invariants & release hardening

## Key Capabilities

- Deterministic event pipeline from ingestion to emission
- Policy-gated execution with audit and lifecycle recording
- Versioned `ServiceContract` boundaries
- Trust-based federation with `NodePolicy` validation
- Strategic planning, mission management and operations dashboards
- Health supervision, fault correlation and recovery coordination
- Marketplace signature verification and capability sandboxing
- Architecture Guard with 10 executable invariants, 100% health score

## CLI

```bash
hydi architecture verify
hydi architecture audit
hydi architecture report
```

## Validation

- `npm test -- --runInBand` — passing
- `npm run architecture-test` — passing, score 100%
- `npm run typecheck` — passing

## Known Limitations

- Long-duration soak testing is a manual/RC-2 activity.
- Plugin permission sandbox is validated by `CapabilitySandbox`; runtime
  environment hardening is tracked in `KNOWN_LIMITATIONS.md`.
