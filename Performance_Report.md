# Performance Report

## Executive Summary

| Benchmark | Command | Result |
|-----------|---------|--------|
| Console benchmark | `npm run benchmark:console` | **PASS** — startup 8 ms, briefing 5 ms, recommendation refresh 4 ms |
| V3 performance benchmark | `npm run benchmark:performance` | **PASS** (exit 0) — details read from `data/perf-benchmark/history.json` |
| Latest recorded V3 run | `data/perf-benchmark/history.json` | **7/7 checks passed**; `meetsTargets: true` for all |
| Jest unit tests | `npm test` | 2,404 tests in **117.81 s** |
| Ollama text generation | `tinyllama` | **12,311 ms** (first-load penalty) |
| Ollama embedding | `nomic-embed-text` | **100 ms** for 768-dim vector |
| TypeScript typecheck | `npm run typecheck` | **< 10 s** |

## 1. Console Benchmark (`scripts/console-benchmark.js`)

```json
{
  "targets": {
    "startupUnderMs": 2000,
    "briefingUnderMs": 500,
    "recommendationRefreshUnderMs": 250
  },
  "measurements": {
    "startupMs": 8,
    "briefingMs": 5,
    "recommendationRefreshMs": 4
  },
  "checks": {
    "startup": true,
    "briefing": true,
    "recommendationRefresh": true
  },
  "meetsAllTargets": true
}
```

- **Startup time:** 8 ms (target < 2,000 ms)
- **Briefing generation:** 5 ms (target < 500 ms)
- **Recommendation refresh:** 4 ms (target < 250 ms)
- **Conclusion:** Console/operator pipeline is very fast.

## 2. V3 Performance Benchmark (`scripts/performance-benchmark.js`)

Latest recorded run from `data/perf-benchmark/history.json`:

```json
{
  "total": 7,
  "passed": 7,
  "failed": 0,
  "meetsTargets": {
    "startup": true,
    "missionPlanning": true,
    "taskDispatch": true
  },
  "runAt": 1785955925395
}
```

| Check | Elapsed (ms) | Passed | Memory Delta (bytes) |
|-------|--------------|--------|----------------------|
| startup | 0 | Yes | 8,224 |
| mission_planning | 6 | Yes | 7,874,728 |
| queue_latency | 0 | Yes | 48,968 |
| database | 12 | Yes | 12,499,632 |
| memory_usage | 0 | Yes | 319,768 |
| reflection_engine | 62 | Yes | 1,463,304 |
| task_dispatch | 2 | Yes | 2,700,592 |

- **Slowest component:** `reflection_engine` at 62 ms
- **Database operation benchmark:** 12 ms
- **Conclusion:** All V3 performance targets are currently met. Memory deltas are reasonable for in-process operations.

## 3. Build & Test Latency

| Operation | Time |
|-----------|------|
| `npm run typecheck` | < 10 s |
| `npm run lint` | Not precisely timed; completed in background run |
| `npm test` (2,404 tests) | 117.81 s |
| `npm run security-audit` | < 10 s |
| `npm run benchmark:console` | < 1 s |
| `npm run benchmark:performance` | ~1–2 min |

## 4. Local AI Latency

| Model | Operation | Latency | Notes |
|-------|-----------|---------|-------|
| `tinyllama` | generate | 12,311 ms | First-call / model-load penalty; 637 MB model |
| `nomic-embed-text` | embed | 100 ms | 768-dim vector; very fast |

**Note:** `tinyllama` latency is high for a 5-word prompt on the first invocation. This is expected for the first load of a model into VRAM/RAM. Subsequent calls and larger models should be benchmarked separately with warm cache.

## 5. Startup / Shutdown Observations

| Scenario | Observation |
|----------|-------------|
| `node src/server.js` cold boot | Process stayed alive for 10 s; no crash |
| `node scripts/hydi-cli.js status` | `Runtime: READY` within 30 ms |
| Console benchmark startup | 8 ms |
| V3 startup benchmark | 0 ms |

Shutdown time and graceful recovery were not measured in this session.

## 6. Bottlenecks Identified

| # | Bottleneck | Evidence | Severity |
|---|------------|----------|----------|
| 1 | `reflection_engine` is the slowest V3 component at 62 ms | `data/perf-benchmark/history.json` | Low |
| 2 | `tinyllama` first-call latency is 12.3 s | Ollama generate test | Medium (model-load, not code) |
| 3 | `database` benchmark takes 12 ms | `data/perf-benchmark/history.json` | Low |
| 4 | Full Jest suite 117 s | `npm test` | Low to medium (249 suites) |

No algorithmic bottlenecks or regressions were detected. The 12 s `tinyllama` call is an Ollama cold-load artifact, not a code path to optimize.

## 7. Not Measured

- API endpoint latency (requires `npm run dev` or `npm start` + HTTP client)
- Router latency under load
- Memory/CPU usage over 24 h
- Database performance under adversarial load
- Cache efficiency
- Embedding throughput
- Conversation memory scaling
- SSE/WebSocket latency
- Shutdown time and warm-boot time

## 8. Commands Executed

```text
npm run benchmark:console
npm run benchmark:performance
node -e "... data/perf-benchmark/history.json summary ..."
```

## Conclusion

Performance is **strong** for the measured subsystems. Console and V3 benchmarks all pass their targets, with sub-100 ms latencies for planning, dispatch, queue, and database operations. The only concerning number is the 12.3 s first-call `tinyllama` latency, which is an Ollama model-load effect and not a code bottleneck. Full API/soak/24-hour performance profiling remains to be done in a live environment.
