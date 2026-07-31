# Switchboard — Tests

Test suites for Switchboard, mirroring the `src/` layout:

```
tests/
  frontend/
  backend/
  scoring/
  overlay/
```

No tests yet — this directory is scaffolding ahead of implementation. Add
a subdirectory test suite alongside the corresponding `src/` module as
each is implemented, and prioritize coverage for `docs/SAFETY_MODEL.md`
constraints (single-lead-session enforcement, no credential duplication)
since those are the hardest requirements to catch via manual review.
