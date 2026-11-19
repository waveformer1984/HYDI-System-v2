# HYDI acceptance matrix

Production acceptance requires **Frank + phone evidence** at a named **Git SHA**. Unit CI alone does not satisfy Phase 8.

**Target SHA (current baseline):** `06cf644d7325ac8b4488913253de54e02b57fb30`

| # | Criterion | Required evidence | Cloud VM | Frank | Phone |
|---|-----------|-------------------|----------|-------|-------|
| A1 | Git identity | `git rev-parse HEAD` | ☐ | ☐ | — |
| A2 | Unit + typecheck | `npm test`, `npm run typecheck` logs | ☐ done on audit | ☐ | — |
| A3 | Runtime health | `/api/health`, `/api/ping`, `:3462/health` | — | ☐ | — |
| A4 | RAM under load | Observer metrics / `free` during Ollama+web | — | ☐ | — |
| A5 | Model inference RTT | Ollama chat round trip ms | — | ☐ | — |
| A6 | Memory retrieval RTT | `hydi_facts` similarity query post-backfill | — | ☐ | — |
| A7 | Voice round trip | STT→reply→TTS wav; log path | — | ☐ | ☐ |
| A8 | Mobile approval RTT | Inline card → POST `/tasks` → 200 | — | ☐ | ☐ |
| A9 | Job lifecycle | mission/fabric QUEUED→COMPLETED with evidence | — | ☐ | — |
| A10 | Restart recovery | PM2 restart; lease/snapshot integrity | — | ☐ | — |
| A11 | Revenue slice | One test-mode LEAD→PAY artifact | — | ☐ | — |

Legend: ☐ = not yet recorded for production acceptance at this SHA.

**Artifact storage (recommended):** `/.runtime/audit/acceptance-<SHA-short>.json` on Frank (gitignored patterns apply — no secrets).