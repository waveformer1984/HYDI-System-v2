# v1.0 Strategic Roadmap

## Goal

Move HYDI from a verified release candidate to a stable, ecosystem-ready platform.

## Phase 1 — Hardening to v1.0

1. **Complete operational validation**
   - 24/72-hour CI soaks
   - Clean deployment reproduction
   - Multi-node federation load test
   - Rollback validation under load

2. **Security hardening**
   - Federation message replay protection
   - OS-level capability sandboxing guide
   - Security audit by an external reviewer

3. **CI/CD**
   - Automated release gates
   - Deterministic artifact builds
   - Reproducible deployment pipeline
   - Manual approval gate before publish

## Phase 2 — Ecosystem Maturity

1. **Plugin SDK**
   - Documented capability manifest format
   - `CapabilitySandbox` API for plugin authors
   - Local development harness

2. **Public API stability**
   - Freeze `ServiceContract` versions for v1.0
   - Publish `API_REFERENCE.md` as living documentation
   - Deprecation policy for v2.0 planning

3. **Developer tooling**
   - `hydi` CLI extensions for `capability build`, `capability test`, `capability publish`
   - Integration test templates
   - Example plugins

## Phase 3 — Observability & Operations

1. **Production dashboards**
   - OperationsDashboard in the hosted UI
   - Alerting on ArchitectureGuard failures
   - Federation topology visualization

2. **Packaging & installation**
   - Docker image with reproducible build
   - Installer for local/offline deployments
   - Cloud deployment templates

## Phase 4 — v1.0.0 Criteria

The following must all be true before `v1.0.0`:

- 30-day production soak with no high-severity incidents
- Deterministic CI/CD with green test suite
- Stable public API for one full minor release
- Security review signed off
- Operator runbooks validated
- Ecosystem SDK published
- One documented major-version migration guide

## Non-Goals

- No new AI capabilities until v1.0 is stable.
- No experimental subsystems on the release branch.
- No speculative architecture changes.
