# Phase 35 — Sovereign Executive Runtime Architecture

## Mission

Advance HYDI from a validated local AI integration layer into a production-grade sovereign executive runtime where models advise, memory provides context, agents specialize, and the ExecutiveOperatingSystem retains all authority.

## Core Principle

> Models provide reasoning. Memory provides context. Agents provide specialization. ExecutionGateway provides control. HYDI remains the authority.

## New Components

| Component | File | Responsibility |
|-----------|------|----------------|
| ModelRuntimeManager | `src/hydi-v3/ModelRuntimeManager.js` | Model lifecycle, warmup, request queue, timeout adaptation, resource monitoring |
| CapabilityProfile | `src/hydi-v3/CapabilityProfile.js` | Score models by task, capability, speed, reliability |
| KnowledgePipeline | `src/hydi-v3/KnowledgePipeline.js` | Ingest, chunk, embed, index, retrieve project documents |
| SemanticMemoryIndex | `src/hydi-v3/SemanticMemoryIndex.js` | Tiered memory with importance, decay, duplicate detection |
| ResearchAgent | `src/hydi-v3/ResearchAgent.js` | Analyze topics, summarize findings, identify opportunities |
| EngineeringAgent | `src/hydi-v3/EngineeringAgent.js` | Inspect repositories, identify technical debt |
| ProductAgent | `src/hydi-v3/ProductAgent.js` | Maintain product priorities and roadmap intelligence |
| FinanceAgent | `src/hydi-v3/FinanceAgent.js` | Analyze financial information and metrics |
| VisionAdapter | `src/hydi-v3/VisionAdapter.js` | Interface for local vision models producing BusinessSignals |
| VoiceInterface | `src/hydi-v3/VoiceInterface.js` | Coordinator for STT/TTS/voice command routing |
| jsconfig | `src/hydi-v3/jsconfig.json` | `checkJs` gate for the intelligence layer |

## Runtime States

`ModelRuntimeManager` tracks every model through:

- `UNAVAILABLE`
- `LOADING`
- `READY`
- `BUSY`
- `FAILED`

## Memory Tiers

`SemanticMemoryIndex` classifies memory into:

- `SHORT_TERM` — current conversation
- `WORKING` — active projects and tasks
- `LONG_TERM` — validated knowledge
- `EXECUTIVE` — strategic decisions and business context

## Routing Intelligence

`ModelRouter` selects models using `CapabilityProfile` scores that consider:

- required capability
- task complexity
- latency sensitivity
- current workload
- reliability history
- context window

## Integration Points

- `OperatorSession` constructs `ModelManager`, `ModelRuntimeManager`, `ModelRouter`, and `EmbeddingManager` when `localAI` is enabled.
- `ConversationEngine` still owns all deterministic routing; `ModelRouter` is an optional intent extractor.
- `ExecutionGateway` and `ApprovalCenter` remain unchanged as the only execution authorities.
- `AuditLedger` records every routing and agent activity.

## What Is Not Yet Wired

- Real vision signal pipeline from camera / screenshots / CAD.
- Real speech-to-text / text-to-speech engines.
- Full coding assistant repository analysis (scaffold exists).
- PDF parser in `KnowledgePipeline`.

## Design Commitment

All new AI paths degrade gracefully. If every local model is offline, HYDI continues to function with deterministic routing and full operational integrity.
