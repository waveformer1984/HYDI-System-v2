# Phase 37 — Performance Analysis

Generated: 2026-07-28

## Hardware-Aware Execution

`src/hydi-v3/ResourceManager.js` was enhanced to detect and act on:

- CPU saturation (`loadAvg / cpus > 0.8`).
- RAM pressure (`freeMem / totalMem < 0.15`).
- GPU presence and utilization (platform-aware detection).
- Thermal throttling (placeholder for platform sensors).
- Model warm state.

`recommendForTask(task, candidates)` routes tasks to the most appropriate
hardware target:

- `embedding` → dedicated embedding model.
- `reasoning` / `planning` / `rag` → largest context reasoning model available.
- `simple` / `intentExtraction` / `conversation` → lightweight local model.
- Under resource pressure it prefers warm, small models.

## Benchmark Database

`src/hydi-v3/BenchmarkDatabase.js` stores append-only benchmark records:

- Provider (Ollama, LM Studio, llama.cpp).
- Model.
- Hardware profile.
- Latency, throughput, startup time, embedding speed.

It supports historical comparisons, provider-vs-provider analysis, and per-model
trend reports.

## Regression Baseline

A re-run of the Phase 36 stability harness under the same 10 Hz throttle showed
no degradation:

- Duration: 5000 ms
- Cycles: 51
- Average cycle time: ~98 ms
- Final heap growth ratio: 6.97%
- Queue depth: 0
- Active tasks: 0
- Retained telemetry entries: 0
- Monotonic heap increase: not detected
- Overall: PASS

## Continuous Self-Evaluation

`scripts/phase37-self-evaluation.js` measured:

- Routing accuracy: 90.0%
- Execution success rate: 80.0%
- Benchmark accuracy: PASS (llama.cpp outperformed Ollama on synthetic
  latency/throughput history).
- Policy compliance: PASS
- Memory quality average: 0.627
