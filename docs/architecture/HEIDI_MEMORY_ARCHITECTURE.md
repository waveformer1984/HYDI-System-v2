# Heidi memory architecture (consolidation map)

**Status:** PARTIAL IMPLEMENTATION — extend existing stores.

| Layer | Source of truth | Retrieval |
|-------|-----------------|----------|
| Working | Mission + chat session | `heidi-core` request context |
| Episodic | `hm_messages`, `mission_events` | `memory search`, `/missions/:id` |
| Semantic | Embeddings (Ollama/OpenAI gated) | Scoped by owner |
| Procedural | Fix-list templates, successful mission `context.success` | Chat commands, observer |
| Strategic | Goals APIs, human-actions | Operator-defined |

Requirements backlog: provenance on every fact, contradiction detection, retention policies — **not implemented**.

Canonical operator doc: `docs/HEIDI_PERSISTENT_MEMORY.md`.