# HYDI CUDA Pool & Local Compute Architecture

This document describes the CUDA Pooling and Local Compute Architecture added to HYDI V3. It is designed to make HYDI a deterministic, self-optimizing, GPU-aware, fully local AI operating system while remaining portable to CPU-only hosts.

## Goals

* Automatically discover CUDA-capable hardware.
* Pool GPU resources and schedule inference across runtimes.
* Place models on the best available device without manual configuration.
* Recover from failures and degrade gracefully when CUDA is unavailable.
* Provide observability and benchmarking hooks for continuous optimization.

## Module Structure

```
src/hydi-v3/
  HardwareDiscovery.js   # Phase 1: platform-aware GPU/CUDA discovery
  CudaPoolManager.js   # Phase 2/5/8/10: allocation, scheduling, health, failover
  OllamaAdapter.js     # Phase 4: first local runtime adapter
  index.js             # exports the new modules

tests/unit/hydi-v3/
  HardwareDiscovery.test.js
  CudaPoolManager.test.js
```

## Hardware Discovery

`HardwareDiscovery` probes the host using `nvidia-smi` first, then falls back to OS APIs:

* Windows: `Get-CimInstance Win32_VideoController`
* Linux: `lspci`
* macOS: `system_profiler SPDisplaysDataType`

For each GPU it reports: model, vendor, VRAM, utilization, temperature, fan speed, PCIe generation/width, compute capability, FP16/BF16/INT8 support, tensor core support, power draw/limit, driver and CUDA version.

On a host without NVIDIA hardware it returns an honest `cudaAvailable: false` inventory instead of crashing or returning mock data.

## CUDA Pool Manager

`CudaPoolManager` is the central scheduler.

Responsibilities:

* Maintain a real-time `gpus[]` inventory from `HardwareDiscovery`.
* Allocate/release GPU/CPU execution slots with VRAM accounting.
* Maintain a prioritized job queue for inference requests.
* Register runtime adapters and choose the best runtime for each job.
* Estimate memory requirements for a model + context + batch size.
* Poll devices, expire stale allocations, and emit health events.
* Gracefully fall back to a `CPU_FALLBACK` device when no CUDA GPUs exist.

Public API:

| Method | Purpose |
|--------|---------|
| `initialize()` | Detect hardware, register adapters, start polling |
| `registerRuntime(adapter)` | Add an inference backend |
| `allocateGPU({ vramBytes, ... })` | Reserve a device |
| `releaseGPU(allocationId)` | Free a reservation |
| `estimateMemory({ parameterBillions, ... })` | Heuristic VRAM estimate |
| `scheduleInference(job)` | Enqueue and execute a prompt/chat job |
| `balanceLoad()` | Refresh live GPU metrics |
| `healthStatus()` | Overall pool health |
| `shutdown()` | Stop polling and release all allocations |

## Runtime Adapters

A runtime adapter exposes a small interface:

```js
{
  name: 'ollama',
  async isAvailable(),
  async getModels(),
  estimateMemory(modelName, quantization, knownSizeBytes),
  async runInference({ model, prompt, messages, options, stream }),
  async health(),
}
```

`OllamaAdapter` is the first concrete adapter and uses the official `ollama` npm package to list models, estimate memory from quantization/parameters, and run `generate`/`chat` calls.

Future adapters planned (Phase 4): llama.cpp, vLLM, OpenVINO, ONNX Runtime GPU, TensorRT, PyTorch CUDA, local embedding servers.

## Model Placement

Placement is handled inside `CudaPoolManager.choosePlacement`:

1. Select the first available runtime (user override, then first healthy).
2. Estimate VRAM using runtime metadata or the built-in estimator.
3. Allocate the GPU/CPU with the best free-VRAM headroom, lowest utilization, and lowest temperature.
4. Execute the job and release the allocation.

This satisfies Phase 3 (Intelligent Model Placement) at a foundational level; a dedicated `ModelPlacementEngine` can be extracted when more runtimes are added.

## Scheduling Policies

`allocateGPU` implements a scoring function that combines:

* Sufficient free VRAM for the job.
* GPU utilization.
* Temperature.
* CPU fallback ordering (always last).

Future policies (Phase 5) can be added as pluggable `strategy` functions: weighted, least-loaded, shortest-job, VRAM-aware, thermal-aware, latency-aware.

## Self-Optimization & Observability

Metrics are kept in `CudaPoolManager.metrics`:

* jobsSubmitted, jobsCompleted, jobsFailed, jobsQueued
* totalLatencyMs
* failedAllocations
* lastBalanceAt

`healthStatus()` exposes queue depth, active jobs, GPU state, runtime errors, and derived issues such as `queue_congested` or `allocation_pressure`.

A future dashboard (Phase 9) can consume these events and metrics via the existing `ObservabilityDashboard` Prometheus export.

## Reliability

* **Graceful degradation**: no CUDA hardware falls back to CPU/Ollama.
* **Automatic failover**: if a runtime is unavailable, `selectRuntime` tries the next one.
* **Stale allocation expiry**: reservations have TTLs and are cleaned on poll.
* **Health polling**: every `pollIntervalMs` refreshes GPU metrics.
* **Watchdog integration**: `AutonomyManager` can be configured to start/stop the pool with the rest of V3.

## Benchmarking

The `PerformanceBenchmark` module already measures startup, planning, dispatch, queue latency, DB, memory, reflection, and task dispatch. The CUDA pool adds per-model telemetry (tokens/sec, peak VRAM, latency) that can be recorded in the same history file.

## Integration with HYDI V3

`AutonomyManager` now accepts `enableCudaPool: true`. When enabled:

```js
const manager = new HYDIAutonomyManager({
  coreLoop,
  config: { enableCudaPool: true },
});
await manager.start();
```

The pool is initialized during `start()` and shut down during `stop()`.

## Current Status

* Phase 1 (Hardware Discovery) and Phase 2 (CUDA Pool Manager) are implemented.
* Phase 4 initial `OllamaAdapter` is implemented.
* Phases 3, 5, 6, 7, 8, 9, 10, 11, 12 are scaffolded inside the pool manager and can be expanded incrementally.

## Known Limitations on This Host

The current Windows machine has only an Intel Iris Xe integrated GPU. `HardwareDiscovery` correctly reports `cudaAvailable: false` and `CudaPoolManager` operates in CPU-fallback mode through Ollama. When this code is deployed on a host with NVIDIA GPUs and `nvidia-smi` on `PATH`, it will detect and pool those devices automatically.

## Migration Plan

1. Merge these modules without enabling `enableCudaPool` in production.
2. Validate Ollama inference routing on existing flows.
3. Enable `enableCudaPool` on a CUDA-enabled test host.
4. Add remaining runtime adapters one at a time.
5. Introduce the WebSocket telemetry dashboard and learning scheduler.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| No NVIDIA hardware today | CPU fallback; true CUDA behavior exercised on GPU hosts |
| Native bindings for future runtimes | Add optional dependencies; keep Ollama as default |
| Memory estimation errors | Conservative headroom + runtime metadata overrides |
| Concurrent job contention | Per-GPU allocation tracking + queue prioritization |

## Optimization Recommendations

* On Intel/CPU-only hosts, prefer small quantized models (`llama3.2:3b`, `qwen2.5-coder:1.5b`).
* Add `nvidia-ml-py` / NVML bindings for richer memory-bandwidth and process-level telemetry.
* Cache model profiles after first load to avoid repeated estimation.
* Use CUDA streams and pinned memory when a native Node CUDA binding is introduced.
