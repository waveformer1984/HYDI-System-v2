# Phase 34 — Local AI Integration & Executive Intelligence Layer

## Objective

Integrate local AI models into HYDI as intelligence providers while keeping the V3 executive architecture as the deterministic source of truth. No cloud dependency for normal operation.

## Architectural Principles

- `ExecutiveOperatingSystem`, `TrustEngine`, `BusinessMemory`, `AuditLedger`, `ApprovalCenter`, and `Learning` remain the authority.
- Local models provide language understanding, planning, summarization, embeddings, and vision observations.
- All model calls are optional and degrade gracefully.
- All business state stays local, auditable, and reproducible.

## New Components

| File | Responsibility |
|------|----------------|
| `src/hydi-v3/ModelConfiguration.js` | Centralized local-AI settings (discovery, routing, embedding, privacy) |
| `src/hydi-v3/ModelRegistry.js` | Live registry of discovered models and capabilities |
| `src/hydi-v3/ModelHealth.js` | Health snapshots per model/provider |
| `src/hydi-v3/ModelMetrics.js` | Latency and success-rate samples |
| `src/hydi-v3/ModelCapabilities.js` | Capability constants and task-to-capability mapping |
| `src/hydi-v3/ModelManager.js` | Discovers providers, routes requests to adapters, aggregates startup report |
| `src/hydi-v3/ModelRouter.js` | Task-based routing: intent extraction, RAG, summarize, plan, code review |
| `src/hydi-v3/BaseAdapter.js` | HTTP base class for OpenAI-compatible and custom endpoints |
| `src/hydi-v3/OllamaAdapter.js` | Ollama `/api/chat`, `/api/generate`, `/api/embeddings`, `/api/tags` |
| `src/hydi-v3/LMStudioAdapter.js` | LM Studio OpenAI-compatible `/v1/` endpoints |
| `src/hydi-v3/LlamaCppAdapter.js` | llama.cpp OpenAI-compatible `/v1/` endpoints |
| `src/hydi-v3/EmbeddingManager.js` | Local embedding storage, cosine similarity search, memory ingestion |
| `src/hydi-v3/ConversationContext.js` | Normalized conversation context for model prompts |
| `src/hydi-v3/PromptLibrary.js` | Intent extraction, RAG, planning, code-review prompts |

## Integration Points

- `OperatorSession` optionally constructs `ModelManager`, `ModelRouter`, and `EmbeddingManager` when `localAI` is configured.
- `ConversationEngine` accepts an optional `modelRouter`; if local intent extraction is enabled and no deterministic regex matches, it asks the local model for an intent and dispatches through the existing cockpit/handler path.
- `ModelRouter` logs every routing decision: task, selected model, latency, success.
- `EmbeddingManager` stores vectors on local disk (`dataPath/embeddings.json`) and never leaves the machine.

## Pipeline Example

```text
Operator: "What should I focus on today?"
  → ModelRouter.extractIntent (local LLM)
  → intent: "focus"
  → ConversationEngine._resolveLLMIntent
  → ExecutiveCockpit.focusForToday
  → ExecutiveOperatingSystem + BusinessMemory
  → recommendation
  → approval (if action required)
  → ExecutionGateway
  → AuditLedger
  → BusinessEvidenceEngine / LearningMetrics / TrustEngine
```

## Discovery

`ModelManager.start()` automatically probes configured providers. On the workstation used for validation it discovered a running Ollama instance with:

- `qwen2.5:7b` (chat, reasoning)
- `llama3.2:3b` (chat)
- `llama3:latest` (chat)
- `nomic-embed-text:latest` (chat, embed)
- `tinyllama:latest` (chat)
- `qwen2.5-coder:1.5b` (chat, code)

Custom mock adapters can be injected via `localAI.adapters` for testing.

## Fallback Strategy

If no local model is reachable:

- `ConversationEngine` falls back to deterministic regex routing (100 % of Phase 33 audit phrases still pass).
- `ModelRouter.rag/summarize/plan/codeReview` return a clear "No model available" message.
- `EmbeddingManager.search` returns an empty result.
- All executive operations continue normally.

## What Is Not Yet Built

- **Real vision pipeline**: vision adapter returns a placeholder; wiring printer camera / screenshots to `BusinessSignal` is not implemented.
- **Coding assistant repository ingestion**: only the prompt and adapter exist; no git/CI/coverage aggregation.
- **Document intelligence PDF parsing**: only summarization prompt exists.
- **Voice interfaces**: only preparation comments; no STT/TTS implementation.
- **Long-duration model benchmarks**: see `phase34-model-benchmarks.md`.
