# Security Review

## Method

Static review of HYDI v3 security-relevant modules and ArchitectureGuard invariants. No live penetration testing was performed.

## Findings

### Authentication

- `requireAuth.js` resolves device tokens to roles and rejects revoked/missing credentials.
- `deviceAuth.test.js` passes signature round-trips and revocation checks.
- **Status:** acceptable

### Authorization

- `NodePolicy.validateAction` filters tasks by trust and required capabilities.
- `rbac.hasPermission` fails closed on unknown roles/permissions.
- `requireAuth` returns 403 for insufficient role permissions.
- **Status:** acceptable

### Trust Boundaries

- `FederationGateway` uses `NodePolicy` before remote execution.
- `DistributedTaskManager.execute()` validates `task.requestedBy` against `NodePolicy`.
- `ArchitectureGuard` invariant `exec-passes-policy` passes.
- **Status:** acceptable

### Replay Protection

- `AuditLedger` is append-only and hashed.
- `LifecycleRegistry.recordProposal` records every state change.
- `FederationGateway` now enforces message `id`, `timestamp` and `expiresAt` with a configurable replay window.
- Duplicate messages are rejected and audited.
- Expired messages are rejected and audited.
- Tests in `FederationReplay.test.js` cover acceptance, expiry, duplicate, pruning and audit.
- **Status:** resolved in rc.2

### Plugin Permissions

- `CapabilitySandbox` enforces declared permissions.
- Runtime test in `ArchitectureGuard` passes: allowed, denied and undeclared permissions handled correctly.
- **Status:** acceptable

### Federation Messaging

- `FederationGateway._receiveRemoteExecute` validates through `policy.validateAction`.
- Audit record emitted for every routed message.
- **Status:** acceptable

### Lifecycle & Upgrades

- `LifecycleRegistry` records every proposal.
- `DeploymentManifest` and `SnapshotManager` support upgrade/rollback verification.
- `verify` and `snapshot` CLI commands pass.
- **Status:** acceptable

### Capability Installation

- **Finding (previously reported "acceptable" in error):** `SignatureVerifier.sign()`/`verify()` did not perform real cryptographic signature verification. `sign()` returned a string that embedded the raw private key argument in plaintext (`sig:${privateKey}:${digest.slice(0,16)}`); `verify()` only checked that a `signature` field was non-empty and that a self-computable SHA-256 digest matched -- it never validated the signature against the publisher's public key. Any actor could compute the (public, deterministic) digest themselves and supply an arbitrary non-empty string as `signature` to pass verification for any known, non-revoked publisher.
- **Compounding finding, found while fixing the above:** `computeDigest()`'s `JSON.stringify(payload, Object.keys(payload).sort())` used the array form of `JSON.stringify`'s replacer, which allowlists property *names* recursively at every nesting level, not just the top level. Because `requiredPermissions`'/`dependencies`' own nested keys were not in that top-level allowlist, their contents were silently dropped from the hashed text -- `requiredPermissions: {filesystem: ['write']}` and `requiredPermissions: {}` produced an *identical* digest. This meant even a real signature never actually bound to a capability's declared permissions or dependencies, so a legitimately-signed capability's permissions could be altered after signing without invalidating its signature.
- **Fix:** `SignatureVerifier` now uses real Ed25519 signing/verification (`crypto.sign`/`crypto.verify`, `SignatureVerifier.generateKeyPair()`) checked against `PublisherRegistry`'s `publicKey` field; a capability whose publisher has no known public key on file fails verification (`publisher_key_unknown`) rather than being trusted implicitly. `computeDigest()` now uses a real recursive canonical serializer that sorts keys at every nesting level, so digests correctly bind to the full contents of `requiredPermissions`/`dependencies`.
- **Verified:** forged signatures (no real private key) are rejected (`signature_invalid`); genuinely-signed capabilities are accepted; a legitimately-signed capability with permissions altered post-signing is rejected (`digest_mismatch` + `signature_invalid`). `scripts/phase40-acceptance.js signature`/`marketplace`/`capability-install` and the full test suite (244 suites / 2320 passed / 1 skipped) all pass with the fix in place.
- **Status:** resolved

## Severity Summary

| Severity | Count |
|----------|-------|
| High | 1 (capability signature verification was non-cryptographic; resolved) |
| Medium | 0 |
| Low | 0 |

## Conclusion

One high-severity finding was identified and resolved during this review cycle: `SignatureVerifier` did not perform real cryptographic verification, and a compounding digest-canonicalization bug meant even a real signature would not have bound to a capability's declared permissions. Both are now fixed and verified against the existing acceptance and unit test suites. The federation message replay hardening opportunity from the prior review cycle has also been implemented and validated. No other findings remain open.
