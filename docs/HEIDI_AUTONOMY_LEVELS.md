# HEIDI Autonomy Levels

## Levels

| Level | Name | Description | Examples |
|-------|------|-------------|----------|
| L0 | OBSERVE | Collect and report state only | `health.read`, `diagnostic.collect` |
| L1 | DIAGNOSE | Classify and correlate failures | `diagnostic.classify`, `test.run` |
| L2 | RECOMMEND | Suggest bounded actions to a human | `build.run` with approval request |
| L3 | AUTO_RECOVER | Execute safe, reversible, low-risk recovery | `health.recover`, `docker.local` restart |
| L4 | MULTI_STEP_RECOVERY | Execute a pre-authorized mission of L3 actions | bounded `MissionEngine` plan |
| L5 | HUMAN_APPROVAL | Requires explicit human approval | `database.local`, `deploy.production` |
| FORBIDDEN | — | Never executed autonomously | `database.destructive`, `volume.delete` |

## Rules

- Unknown capabilities default to `FORBIDDEN`.
- `L5` requires `approve()` or a pre-existing approved task.
- `FORBIDDEN` cannot be overridden by a mission or LLM output.
- Autonomy levels are configured in `src/heidi-executive/AutonomyPolicy.js`.
- A mission cannot raise its own autonomy level.
