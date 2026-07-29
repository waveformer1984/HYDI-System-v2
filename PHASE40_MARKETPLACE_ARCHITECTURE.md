# Phase 40 — HYDI Verified Capability Marketplace

## Purpose

Phase 40 builds a secure, local-first ecosystem where agents, skills, workflows,
model adapters, hardware drivers, UI extensions, and integration connectors can
be discovered, verified, installed, upgraded, governed, and retired without
compromising the HYDI platform.

## Capability Format

Every installable capability exposes structured metadata:

- `id` — unique identifier
- `version` — semantic version
- `type` — Agent, Skill, Workflow, Model Adapter, Hardware Driver, UI Extension, Integration Connector
- `publisher` — publisher identity
- `description`
- `category`
- `requiredHYDIVersion` — compatibility range
- `dependencies` — required capabilities
- `requiredPermissions` — filesystem, network, execution, memory, externalApis, hardware, models
- `hardwareRequirements`
- `supportedPlatforms`
- `offlineCompatible`
- `license`
- `signature` — publisher signature
- `digest` — SHA-256 over the capability payload

## Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| CapabilityRegistry | `src/hydi-v3/CapabilityRegistry.js` | Tracks installed capabilities and their state (installed, quarantined, removed). |
| PublisherRegistry | `src/hydi-v3/PublisherRegistry.js` | Tracks publishers, trust levels, revocation, and reputation. |
| SignatureVerifier | `src/hydi-v3/SignatureVerifier.js` | Computes digests and verifies or signs capability packages. |
| RepositoryManager | `src/hydi-v3/RepositoryManager.js` | Supports official, local, enterprise, offline, and development repositories. |
| DependencyResolver | `src/hydi-v3/DependencyResolver.js` | Deterministic dependency resolution with circular/incompatible/conflict detection. |
| CapabilitySandbox | `src/hydi-v3/CapabilitySandbox.js` | Extends PluginRuntime with sandbox isolation and resource budgets. |
| CapabilityInstaller | `src/hydi-v3/CapabilityInstaller.js` | Safe install, uninstall, and rollback with pre-install snapshots. |
| MarketplaceManager | `src/hydi-v3/MarketplaceManager.js` | Coordinates discovery, verification, install, update, remove, rollback, and publish. |
| MarketplaceDashboard | `src/hydi-v3/MarketplaceDashboard.js` | Aggregates marketplace, trust, repository, dependency, and resource state. |

## Trust Levels

- `official` — HYDI core or verified partner
- `verified` — vetted by the operator
- `enterprise` — enterprise publisher
- `community` — community publisher
- `development` — local development publisher
- `untrusted` — quarantined or revoked

Rules:

- Unsigned packages cannot auto-install without explicit operator approval.
- Incompatible packages are blocked by the dependency resolver.
- Expired or mismatched signatures generate warnings.
- Revoked publishers are rejected by the publisher registry.

## Repository Support

HYDI can query multiple repositories simultaneously:

- Official Repository
- ProtoForge Repository
- Local Repository
- Enterprise Repository
- Offline Repository
- Development Repository

Offline repositories behave exactly like online repositories except they do not
attempt network synchronization.

## Capability Sandbox

Every capability executes inside `CapabilitySandbox`, an extension of
`PluginRuntime` from Phase 39. The sandbox isolates:

- filesystem
- network
- memory
- process spawning
- hardware
- AI models
- external APIs

Capabilities must declare `requiredPermissions` before installation. The sandbox
fails closed: any unpermitted action is denied.

## Dependency Resolver

`DependencyResolver` builds an installation plan before any files change:

- Detects circular dependencies
- Detects missing dependencies
- Detects incompatible version ranges
- Detects conflicts with already-installed capabilities
- Produces a deterministic installation order

## Installation and Rollback

`CapabilityInstaller` follows the Phase 39 lifecycle:

1. Resolve dependencies.
2. Capture a pre-install snapshot.
3. Verify signatures and publisher trust.
4. Install each capability in dependency order.
5. Register the capability in the sandbox and lifecycle registry.
6. Report the installation.

On failure, the installer restores the pre-install snapshot and rolls the
registry back. Manual `rollback(installationId)` removes every capability in the
installation and restores the snapshot.

## Certification Pipeline

Before publication, capabilities are expected to validate:

- type safety
- tests
- lifecycle compliance
- rollback support
- documentation
- compatibility
- permission declarations
- performance budget

`SignatureVerifier.sign` and `MarketplaceManager.publish` provide the metadata
and repository hooks for a full certification pipeline.

## Operator Approval Workflow

Every installation generates an auditable record:

- capability identity
- publisher
- requested permissions
- risk score derived from trust level
- compatibility report
- rollback plan
- estimated resource usage

Operator decisions become part of the marketplace audit history.

## Local AI Runtime Integration

Capabilities may advertise preferred runtimes:

- Ollama
- llama.cpp
- vLLM
- Gemini API
- OpenAI API
- Custom local runtime

Runtime selection remains policy-driven and is not hard-coded.

## CLI

```bash
hydi marketplace search <query>
hydi marketplace install <id>
hydi marketplace verify <id>
hydi marketplace update <id>
hydi marketplace remove <id>
hydi marketplace publish <repo> <id>
```

## Testing

Phase 40 validates:

- `npm run marketplace-test`
- `npm run repository-test`
- `npm run signature-test`
- `npm run dependency-test`
- `npm run sandbox-test`
- `npm run capability-install-test`
- `npm run rollback-test`
- `npm run lifecycle-test`
- `npm run typecheck`
- `npm test`

The acceptance suite `scripts/phase40-acceptance.js` executes every scenario and
writes `reports/business-os/phase40-marketplace-report.md`.
