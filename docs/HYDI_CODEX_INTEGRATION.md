# HYDI Codex integration architecture

**Goal:** Accelerate HYDI development with OpenAI Codex **without** coupling runtime to Codex or breaking local Ollama operation.

## Principles

1. **Codex is a dev tool**, not the production inference path.
2. **No API keys** in CI logs; use Cursor Cloud agents + repository CI for gated automation.
3. **Provider independence:** `HYDI_ALLOW_PAID_LLM` unchanged for production routes.

## Proposed agent roles (development-time)

| Agent | Input | Output | Execution surface |
|-------|-------|--------|-------------------|
| Repository analyst | git tree, AGENTS.md | Architecture notes | Cursor agent / Codex CLI |
| PR reviewer | diff | Review comments | Human-approved post |
| Test generator | changed modules | Jest tests | PR branch |
| Security reviewer | diff | Findings doc | `docs/` only |
| Doc engineer | code + mission | Markdown | PR branch |
| Regression detector | CI logs | Summary | GitHub comment (operator) |

## OpenAI-supported interfaces (verify at use time)

| Interface | Use |
|-----------|-----|
| Codex product | IDE-integrated agentic coding |
| ChatGPT Team/Business | Human pairing — **not** HYDI API |
| Platform API | Runtime Heidi — separate via `openai-adapter` |

## HYDI-native integration points

- **Cursor Cloud Agents** — already run on `clean-main` with environment.json  
- **Local CI** — `npm run ci:local` before push  
- **Governance gate** — migrations require tests + `STATE_MACHINE_APPROVED`  
- **Dev workforce** — `lib/dev-workforce/coordinator.js` could accept `capabilityId: 'tests.run'` with confirm gate

## Workflow (recommended)

```text
Issue/Mission → Mission Control doc → Branch per agent
  → Codex/Cursor implements → jest + typecheck
  → Human review → PR (no auto-merge)
```

## Classification

| Item | Status |
|------|--------|
| Codex in HYDI runtime | **BLOCKED** (by design) |
| Cursor agents for repo work | **VERIFIED LIVE** (this mission) |
| Codex CLI wired in repo | **CONFIGURED BUT UNTESTED** |
| OpenAI Codex subscription = API | **Not assumed** |