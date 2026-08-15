# HYDI Current Test and Evidence Inventory

## Current test totals

Last verified during this audit:

```text
Test Suites: 262 passed, 262 total
Tests:       1 skipped, 2503 passed, 2504 total
Snapshots:   0 total
```

Source: `npm test` at HEAD `8f7ffcc`.

### Suite breakdown

| Category | Count | Notes |
|---|---|---|
| Unit tests | ~120 files | `tests/unit/` |
| HYDI V3 unit | 95+ files | `tests/unit/hydi-v3/` |
| Integration tests | 12 files | `tests/integration/` (require live Supabase) |
| Migration tests | 73+ files | `tests/migrations/` |
| Focused Photo Forge tests | 3 files | `photo-forge-context`, `heidi-chat-sse`, `photo-forge-capability` |

## Test categories

### Strong evidence

| File | What it proves |
|---|---|
| `tests/unit/heidi-chat-pipeline.test.js` | Local-first mock provider chat pipeline |
| `tests/unit/worker-queue-live.test.js` | Postgres enqueue/dequeue/complete lifecycle |
| `tests/unit/photo-forge-capability.test.ts` | Context changes with workspace state |
| `tests/unit/hydi-v3/SecurityAuditor.test.js` | XSS/SQLi/CSRF/eval detection |
| `tests/unit/validation-tooling-integrity.test.js` | Prevents validation tooling defects |
| `tests/unit/hydi-v3/RC2Hardening.test.js` | Soak harness, resource auditor, determinism |

### Superficial or mock-only tests

Some tests mock the LLM provider (`tests/unit/heidi-core-loop.test.js`) and only prove the orchestration path, not actual model behavior. They are valid for transport logic but not semantic correctness.

### Environment-dependent tests

| File | Requirement |
|---|---|
| `tests/unit/hydi-v3/CudaPoolManager.test.js` | `RUN_OLLAMA_TESTS=true` |
| `tests/integration/**/*.test.js` | live Supabase |
| `tests/hdi-adversarial.test.js` | live Supabase |

### Skipped tests

| Test | Reason |
|---|---|
| `tests/unit/hydi-v3/CudaPoolManager.test.js` | conditional on `RUN_OLLAMA_TESTS` |

## Runtime evidence inventory

| Evidence | Location | What it shows | Status |
|---|---|---|---|
| Phase 15 pcap | `artifacts/phase15-network-capture.pcap` | 0 non-local packets | HISTORICAL |
| Phase 3 chat SSE | `C:\tmp\chat-sse.txt` | `metadata`, `content`, `[DONE]` | SAVED |
| Phase 4 production SSE | `C:\tmp\prod-photo-forge-chat.txt` | 200 + SSE under `npm start` | SAVED |
| Phase 5 State A/B | `C:\tmp\photo-forge-state-a.json`, `photo-forge-state-b.json` | Context differs by state | SAVED |
| Health response | `curl /api/status` | `memory_connected: true` | RUNTIME |
| Build output | `npm run build` | `Compiled successfully` | CURRENT |
| Start output | `npm start` | `Ready in 621ms` | CURRENT |
| Network boundary | `netstat -an` | only localhost:3000 | CURRENT |

## Missing evidence

* Current packet capture (Phase 15 is historical).
* 24-hour operational soak.
* Failure-injection (chaos) soak.
* Clean-VM qualification.
* Real Ollama semantic response.
* Full multi-agent `api/chat/route.js` end-to-end.
* Stripe Connect live webhook.

## Artifacts from earlier phases

| Report | Relevance |
|---|---|
| `HYDI_PHASE15_FINAL_LOCAL_FIRST_VERIFICATION_REPORT.md` | Historical local-first packet evidence |
| `reports/phase3/PHOTO_FORGE_PHASE3_RUNTIME_ACCEPTANCE.md` | Dev runtime evidence |
| `reports/phase4/PRODUCTION_RUNTIME_HARDENING_REPORT.md` | Production runtime fix |
| `reports/phase5/PHOTO_FORGE_FUNCTIONAL_CAPABILITY_QUALIFICATION.md` | Functional capability |
