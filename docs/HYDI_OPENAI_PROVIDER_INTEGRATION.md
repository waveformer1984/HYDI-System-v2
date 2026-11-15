# HYDI OpenAI provider integration

## Existing architecture

| Layer | Module | Behavior |
|-------|--------|----------|
| Spend gate | `lib/cost/paid-llm-gate.js` | Paid keys ignored unless `HYDI_ALLOW_PAID_LLM=true` |
| Chat fallback | `lib/ModelManager.ts` | Anthropic then OpenAI chat/completions |
| Embeddings | `lib/embeddings.ts` | OpenAI only if `EMBEDDING_PROVIDER=openai` explicitly |
| Frontend | `apps/ursula-frontend` | Duplicate gate copy — keep in sync |

## New adapter (master mission)

**Module:** `lib/providers/openai-adapter.js`

| Feature | Support |
|---------|---------|
| Responses API | `createResponse()` — live when allowed |
| Mock mode | Default when paid switch off |
| Streaming | Mock returns single chunk; live passes through when implemented |
| Tool calling | Request body `tools` forwarded in live mode |
| Usage tracking | Returns `usage` when present |
| Timeouts | `HYDI_OPENAI_TIMEOUT_MS` (default 30s) |
| Capability probe | `capability(env)` |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Server-side only |
| `HYDI_ALLOW_PAID_LLM` | Must be `true` for live |
| `HYDI_OPENAI_ADAPTER_MODE` | `mock` \| `live` (forces mode) |
| `HYDI_OPENAI_TIMEOUT_MS` | Fetch timeout |

## Security requirements (met in adapter)

- No frontend exposure  
- Live calls blocked without operator switch  
- Mock classification: `VERIFIED_SIMULATED`  
- Live classification: `VERIFIED LIVE` or `REQUIRES_OPERATOR_APPROVAL`

## Tests

`tests/unit/openai-adapter.test.js`

## Ollama preservation

Adapter is **additive**; ModelManager local path unchanged when keys gated off.