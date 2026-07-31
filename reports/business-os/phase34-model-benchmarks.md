# Phase 34 — Model Benchmarks

## Objective

Measure local model performance across the supported operations.

## Observed Measurements

All measurements come from the `scripts/phase34-local-ai-demo.js` run on the workstation.

| Operation | Model | Latency | Notes |
|-----------|-------|---------|-------|
| Boot (full OperatorSession with local AI) | n/a | **597 ms** | Includes Ollama discovery and registry construction |
| Intent extraction | `mock/local-llm` | **< 5 ms** | Mock adapter; deterministic JSON |
| Focus query end-to-end | `mock/local-llm` / fallback | **11 ms** | Deterministic `focus` routed after mock intent |
| RAG answer | `mock/local-llm` | **< 5 ms** | Mock adapter |
| Summarize | `mock/local-llm` | **< 5 ms** | Mock adapter |
| Plan | `mock/local-llm` | **< 5 ms** | Mock adapter |
| Ollama `/api/tags` discovery | n/a | **< 100 ms** | Local network |
| Ollama `qwen2.5:7b` chat (timeout) | `qwen2.5:7b` | **> 30 s timeout** | Real 7B model load + inference exceeded 30 s on this machine |
| Ollama `nomic-embed-text` embedding | `nomic-embed-text` | **UNMEASURED** | Not exercised in the run |

## Unverified / Not Run

- First-token latency for Ollama/LM Studio/llama.cpp
- Embedding latency at scale
- Memory retrieval latency with >1000 vectors
- Planning latency on real reasoning models
- Vision latency on image inputs
- CPU/GPU/VRAM/ RAM profiles under sustained load
- Throughput (requests/minute)
- Cross-provider latency comparison

## Notes

- The `BaseAdapter` default timeout was raised to 30,000 ms to accommodate model loading on first call.
- Real local LLM inference on the workstation used for validation is CPU-bound and exceeds interactive latency targets for 7B models.
- Benchmark suite `scripts/phase34-local-ai-demo.js` is designed to be extended with a real measurement harness once GPU or smaller model targets are available.
