# Heidi agent Phase 2 — Frank operator runbook (Steps 4–6)

Local-first deploy of `heidi-core/heidi-agent.js` under PM2 with snapshot lease, triple gate, and health on **:3462**. **Do not set `HEIDI_ALLOW_EXEC=true`**.

## Preconditions

- Branch `heidi-agent-phase2` merged or checked out on Frank (`C:\Users\Owner\HYDI-System-v2`).
- Supabase up; `heidi_decision_bounds` row populated (agent BLOCK-cycles without it — by design).
- Phone thin client has `HYDI_PHONE_READ_TOKEN` matching Frank (`~\.hydi\thin-client.env` or QR provision).

## Step 4 — Phone fleet (`hydi.py`)

After Frank serves `GET /api/phone/observe` with `heidiAgentLoop`, the phone dashboard **Fleet** card **Heidi agent** shows:

- `exec off`, lease held/open, cycle count (from Frank’s loopback probe of `:3462/health`).
- If `allow_exec` is true on Frank, the card shows **error** (operator must fix PM2 env).

No phone change enables execution.

### Phone action advisor (CLI only)

- Logic lives in repo-root `hydi.py` (`advise_proposal`).
- **Do not** run `heidi_advisor.py` over `~/hydi/heidi.py` on the phone — use the dedicated CLI:

  ```bash
  FRANK_IP=heidi-pc.tailc50af2.ts.net python3 heidi_advisor.py advise "proposal text"
  ```

- **Frank path:** `GET http://$FRANK_IP:11434/api/tags` (≤3s); if OK, `POST /api/generate` (≤30s).
- **Fallback:** `http://127.0.0.1:8080` llama.cpp (≤90s on-device mistral-7b).
- Any timeout, transport error, or malformed model output → `verdict: BLOCK`, `confidence: 0`, reason in JSON + `events` log — never AUTO-APPROVE/REVIEW on failure.
- **Removed:** `POST /api/advisor/verdict` was previously on the embedded HTTP server in `hydi.py` (`HydiHandler.do_POST`, default dashboard port **3006**). It is **not** wired through `launch-heidi-mobile.js` (that file is unchanged). Verdicts are CLI-only now.

## Step 5 — Automated checks (cloud or Frank)

```bash
npx jest tests/unit/heidi-agent-phase2.test.js tests/unit/action-advisor.test.js \
  tests/unit/start-heidi-agent-phase2-wiring.test.js tests/unit/http-server-security.test.js \
  tests/unit/heidi-agent-loop-probe.test.js tests/unit/frank-observation.test.js \
  tests/unit/hydi-heidi-agent-phase2.test.js tests/unit/hydi-phone-advisor.test.js --runInBand --forceExit
python3 tests/hydi_phone_advisor_test.py
node scripts/check-port-registry.js
```

## Step 6 — Frank bring-up (Jordan)

```powershell
cd C:\Users\Owner\HYDI-System-v2
git fetch origin heidi-agent-phase2
git checkout heidi-agent-phase2   # or merge to clean-main first

# Agent only (smoke)
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-heidi-everything.ps1 -AgentOnly

# Full fleet
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-heidi-everything.ps1
pm2 save

Invoke-WebRequest http://127.0.0.1:3462/health -UseBasicParsing | Select-Object -ExpandProperty Content
pm2 logs heidi-agent --lines 80
```

**Acceptance**

| Check | Pass criteria |
|--------|----------------|
| PM2 | `heidi-agent` **online** |
| Health | `allow_exec: false`, `lease_held` boolean, `cycles` number |
| Exec | No task execution in logs when `HEIDI_ALLOW_EXEC` unset/false |
| Bounds | If bounds missing: log `BLOCK — heidi_decision_bounds missing or empty`, process stays up |
| Phone | Fleet card **Heidi agent** matches loop probe via observe |
| SIGINT | `pm2 stop heidi-agent` → final snapshot with `lease_released: true` in `heidi_state_snapshots` |

## Rollback

```powershell
pm2 stop heidi-agent
pm2 delete heidi-agent
pm2 save
```

Revert `ecosystem.config.js` env block for `HEIDI_AGENT_PERSISTENT_LOOP` if needed.