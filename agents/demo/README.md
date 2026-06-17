# Demo User Agent

Simulates a demo user walking through the HYDI/Heidi system. Covers every major
interaction path: briefing → chat → status → task creation → approval workflow →
agent swarm → revenue queries → session summary.

## Quick start

```bash
# Mock mode (no running server needed — great for demos and CI)
npx ts-node agents/demo/demo-user-agent.ts

# Live mode — requires HYDI dashboard running on port 3000
npx ts-node agents/demo/demo-user-agent.ts --live

# Live mode against the Heidi Chat Portal (port 3003)
npx ts-node agents/demo/demo-user-agent.ts --live --portal

# Run a specific scenario
npx ts-node agents/demo/demo-user-agent.ts --scenario health
npx ts-node agents/demo/demo-user-agent.ts --scenario tasks
npx ts-node agents/demo/demo-user-agent.ts --scenario revenue
npx ts-node agents/demo/demo-user-agent.ts --scenario swarm

# Verbose output (raw API response bodies)
npx ts-node agents/demo/demo-user-agent.ts --live --verbose
```

## Scenarios

| Scenario | What it covers |
|----------|----------------|
| `full` | Complete end-to-end walkthrough (default) |
| `health` | Briefing → Ursula status → pipeline health → health endpoint |
| `tasks` | Task creation → approval queue → approve → reject |
| `revenue` | Revenue snapshot → stream breakdown → ProtoForge policy check |
| `swarm` | Autopilot swarm → Hyve opportunities → KILO hypotheses → CASCADE classification |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `HYDI_DASHBOARD_URL` | `http://localhost:3000` | HYDI dashboard base URL |
| `HEIDI_PORTAL_URL` | `http://localhost:3003` | Heidi Chat Portal base URL |
| `DEMO_USER_ID` | `demo-user-001` | User identity sent in `x-user-id` header |
| `HYDI_SERVICE_SECRET` | `demo-secret-key-for-local-testing` | HMAC secret for service tokens |

## What the agent demonstrates

1. **System briefing** — Heidi loads a live summary on session start
2. **Conversational chat** — natural language queries routed to the right subsystem
3. **Ursula queries** — system status, pipeline health, determinism metrics
4. **Task creation** — typed tasks with priority, confidence, approval flags, and arguments
5. **Approval workflow** — list pending → approve or reject with reason → confirm queue
6. **Autopilot swarm** — multi-agent DAG triggered from a single natural language goal
7. **Hyve / CASCADE / KILO** — direct agent queries with `system` routing parameter
8. **Revenue operations** — cross-stream snapshots and ProtoForge policy checks
9. **Session summary** — final wrap-up and stats printout

## Output format

Colour-coded terminal output:
- `▶ User:` yellow — messages sent by the demo user
- `◀ Heidi:` green — responses from the system
- `✓` green — successful operations
- `✗` red — failures
- `ℹ` blue — informational notes
- `📋` magenta — task creation summaries
