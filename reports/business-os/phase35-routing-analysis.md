# Phase 35 — Routing Analysis

## How Routing Works

1. `ModelRouter` receives a task (`intentExtraction`, `conversation`, `rag`, `summarize`, `plan`, `codeReview`, `embed`, `vision`).
2. `CapabilityProfile` scores every healthy model in the `ModelRegistry` for that task.
3. The highest-scoring model is selected and passed to `ModelRuntimeManager`.
4. `ModelRuntimeManager` queues the request, tracks state (`READY`/`BUSY`/`FAILED`), measures latency, and applies adaptive timeouts.
5. Every routing decision is logged with model ID, latency, and success.

## Scoring Factors

| Capability | Conversation | Planning | Code Review | Summarization | Embedding | Vision |
|------------|-----------:|---------:|------------:|--------------:|----------:|-------:|
| Chat | +100 | +0 | +0 | +0 | — | — |
| Reasoning | — | +30 | — | — | — | — |
| Code | — | — | +40 | — | — | — |
| Long context | — | — | — | +20 | — | — |
| Embed | — | — | — | — | +100 | — |
| Vision | — | — | — | — | — | +100 |
| Reliability | × 100 base | × 100 base | × 100 base | × 100 base | × 100 base | × 100 base |

## Observed Routing Log

From `phase35-model-benchmark.js`:

- `intentExtraction` → `mock/local-llm` (0 ms)
- `conversation` → `mock/local-llm` via RAG fallback (0 ms)
- `rag` → `mock/local-llm` (0 ms)
- `summarize` → `mock/local-llm` (0 ms)
- `plan` → `mock/local-llm` (0 ms)

With Ollama models available, `ModelRouter` would prefer `qwen2.5:7b` for planning/RAG, `qwen2.5-coder:1.5b` for code, `nomic-embed-text` for embeddings, and `tinyllama` for fast classification.

## Failover

If the selected model is unhealthy, the next highest score is used. If no model matches, `ModelRouter` returns a clear error and `ConversationEngine` falls back to deterministic regex routing.
