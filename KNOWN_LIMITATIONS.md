# HYDI Known Limitations

## Testing

- Long-duration soak tests (24–72 hours) are configured but not executed
  automatically in CI due to wall-clock constraints.
- Parallel determinism is monitored by `DeterminismGuard`; some I/O-bound tests
  may still show environment-specific timing.

## Federation

- Federation is stable in unit tests; sustained load validation requires a
  multi-node integration environment.

## Marketplace

- Plugin permissions are enforced by `CapabilitySandbox`. Operating-system-level
  sandboxing (containers, seccomp) is not implemented in this release.

## Performance

- Baseline values are environment-dependent. Re-capture on the target deployment
  hardware before declaring a regression.

## Documentation

- `OPERATOR_RUNBOOK.md` and `DISASTER_RECOVERY.md` cover common paths.
  Site-specific runbooks should be derived from them.
