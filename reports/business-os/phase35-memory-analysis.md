# Phase 35 — Memory Analysis

## Components

- `EmbeddingManager` stores vectors locally in `dataPath/embeddings.json`.
- `SemanticMemoryIndex` adds tiering, importance, decay, duplicate detection, and relevance ranking.
- `KnowledgePipeline` converts project documents into embedded chunks for retrieval.

## Operations

| Operation | Latency | Result |
|-----------|--------:|--------|
| `SemanticMemoryIndex.remember` | < 10 ms | Embeds and stores a memory with tier/importance |
| `SemanticMemoryIndex.recall` | ~8 ms | Searches embeddings, applies decay + tier boost |
| `KnowledgePipeline.ingestDirectory` | ~5 ms | Reads files, chunks, embeds, persists |
| `KnowledgePipeline.query` | sub-ms after index | Returns top-k relevant chunks |

## Tiering Behavior

Executive-tier memories receive a small score boost and decay more slowly in recall. Working-tier items dominate active-context queries. Long-term memories are used for validated facts. Short-term is reserved for the current conversation (currently handled by `SessionMemory`).

## Duplicate Detection

`SemanticMemoryIndex` detects duplicate text by cosine similarity above the configured `duplicateThreshold` (default 0.95) and increments importance instead of storing redundant entries.

## Privacy

All embeddings are computed and stored on the local machine. No vector data leaves disk. The storage file is JSON, not a cloud vector database.

## Future Work

- Introduce an approximate nearest-neighbor index for >10k vectors.
- Add explicit eviction policy by tier and age.
- Persist memory summaries to reduce query-time computation.
