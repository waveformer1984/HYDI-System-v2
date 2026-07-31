# Phase 35 — Runtime Performance

## Source

`scripts/phase35-model-benchmark.js` on the local workstation.

Environment:

- Node: `v24.11.1`
- Platform: `win32`
- CPU: 12 logical cores
- Memory: 16 GB

## Results

| Test | Status | Latency (ms) | Notes |
|------|--------|-------------:|-------|
| Model discovery | ✅ | 62.12 | Ollama discovered on `localhost:11434`; 7 models listed |
| Cold start inference | ✅ | 0.44 | Mock adapter; represents first-call model load path |
| Warm inference | ✅ | 1.66 | Intent extraction via `ModelRouter` to `mock/local-llm` |
| Memory retrieval | ✅ | 8.75 | Semantic recall across executive + working tiers |
| Context assembly | ✅ | 5.76 | Document ingestion + relevant chunk retrieval |
| Agent routing | ✅ | 3.29 | `ResearchAgent` + `ProductAgent` dispatched through `ModelRouter` |
| Capability scoring | ✅ | 0.11 | `CapabilityProfile` scoring per task |

## Resource Usage

- RSS: 45.7 MB
- Heap used: 7.3 MB
- External: 2.3 MB

## Interpretation

All measured operations are sub-100 ms with the mock adapter. The architecture overhead is minimal. Real Ollama CPU inference (7B models) is expected to be seconds, not milliseconds, on this hardware. The benchmark establishes a clean baseline for future GPU or quantized model comparisons.
