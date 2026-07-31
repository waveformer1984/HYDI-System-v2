# Version Compatibility

## 0.9.0-rc.1

This release candidate preserves compatibility with all phases from 34 to 44.

| Subsystem | Contract | Version | Notes |
|-----------|----------|---------|-------|
| Federation Gateway | `federation.remoteExecute` | 1.0.0 | Validates `from` and `task` inputs |
| Federation Gateway | `federation.capabilityQuery` | 1.0.0 | Validates `from` and `capability` inputs |
| Capability Broker | `capabilityBroker.query` | 1.0.0 | Validates `capability` input |
| Service Contract | `serviceContract` | 1.0.0 | Semantic version comparison |
| Node Policy | `validateAction` | 1.0.0 | Trust-based action validation |

## Compatibility Rules

- Callers must declare a `ServiceContract` version.
- `ServiceContract.compatible` rejects older, incompatible callers.
- Public subsystems must expose `getContract()` or a `serviceContract` property.

## Future Releases

- 0.9.x releases are backward-compatible with 0.9.0
- 1.0.0 will remove any 0.9.x deprecated interfaces after an announced migration window
