# Checkpoint QA System

Risk-scored workflow analysis engine for the Ursula EPM Suite.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/checkpoint/health` | Liveness check |
| POST | `/checkpoint/workflow/analyze` | Submit workflow for risk scoring |
| GET | `/checkpoint/workflow/<id>` | Get full workflow report |
| GET | `/checkpoint/workflows` | List all analyzed workflows |
| POST | `/checkpoint/audit` | Submit checkpoint audit result |
| GET | `/checkpoint/audits/<checkpoint_id>` | Get audit history for a checkpoint |

## Risk Scoring

Base risk by category:
- `electronics` → 6
- `automotive` → 7  
- `household` → 3
- other → 5

Keyword modifiers (applied to step name):
- `wiring` or `electrical` → +2
- `remove` or `install` → +1
- max score capped at 10

Risk levels: `LOW` (<4) / `MEDIUM` (4-5) / `HIGH` (6-7) / `CRITICAL` (8+)

Checkpoints are auto-created for any step with `risk_score >= 7`.

## Running the Test Suite

```powershell
.\tests\phase2_test_suite.ps1
```

Requires Ursula server running at `http://localhost:5000`.

## Dashboard

Open `dashboard/dashboard.html` in a browser. Connects to `http://localhost:5000` directly.
