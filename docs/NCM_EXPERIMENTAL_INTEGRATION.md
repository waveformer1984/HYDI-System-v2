# NCM experimental integration (HYDI multi-architecture intelligence)

**Status:** Experimental branch — not production default.  
**Official research:** [Hazy Research blog (Oct 2026)](https://hazyresearch.stanford.edu/blog/2026-10-12-ncm) · [arXiv:2610.14162](https://arxiv.org/abs/2610.14162) · [GitHub: HazyResearch/ncm](https://github.com/HazyResearch/ncm) · [HF checkpoints](https://huggingface.co/hazyresearch/ncm-checkpoints)

## What NCM is (and is not)

| | Autoregressive LLM (Ollama) | NCM (research) |
|---|---------------------------|----------------|
| Generation | One token at a time | Coarse-to-fine **levels**; parallel within each level |
| HYDI role today | Production chat, tools, planning | **Optional** accelerator for selected tasks |
| Drop-in? | Yes (`lib/ModelManager.ts`) | **No** — separate tokenizer, checkpoints, task-specific weights |

Reported **10–31×** speedups in the paper compare NCM to **diffusion LM baselines**, not to GPT/Claude or your local Llama/Qwen stack. Treat those numbers as architecture research, not a phone UX promise.

## HYDI architecture (additive)

```
HYDI Intelligence Router (lib/inference/intelligence-router.js)
  ├─ LLM engine      → lib/ModelManager.ts → Ollama (existing)
  ├─ NCM engine      → services/ncm-inference (Python, :8791)
  ├─ Memory engine   → embeddings / heidi_memory (unchanged)
  └─ Agent engine    → missions / ActionExecutor (unchanged)
```

**Gates (all required for NCM on the chat path):**

- `HYDI_NCM_ENABLED=1`
- `HYDI_INTELLIGENCE_ROUTER=1`
- `HYDI_ROUTER_TASK` ∈ `planning` \| `summarization` \| `draft_outline` \| `parallel_draft` \| `unconditional_sample`

Without these, behavior is **identical** to pre-integration `ModelManager` routing.

## Repository audit summary (official implementation)

| Item | Finding |
|------|---------|
| Code | Python 3.10+, PyTorch (CUDA recommended), `evaluate.py` + `config/eval/*.yaml` |
| Checkpoints | Per-task folders (`xsum`, `wmt14`, `sudoku-*`, `lm1b`, `tinystories`, `owt`) |
| Tokenizer | Multiscale residual VQ — **not** Ollama tokenization |
| CPU-only | Community PRs for MPS/CPU; production benchmarking should still target Frank’s GPU |
| Agent use | No general tool-use checkpoint; summarization / translation / sudoku are the released tasks |

## Resource guidance (planning, not measured on cloud agent VM)

| Resource | Mock service | Official NCM (typical) |
|----------|--------------|------------------------|
| RAM | &lt; 200 MB | Checkpoint-dependent (GB+) |
| GPU | None | Strongly recommended for benchmark parity with paper |
| Disk | Negligible | HF artifacts (per task) |
| Ports | `8791` (`HYDI_NCM_PORT`) | Isolated from `:11434` Ollama |

Run `scripts/benchmark-ncm-integration.js` on Frank after checkpoints download for **measured** numbers.

## Benchmark and promotion gates

```bash
# Mock sidecar + router unit tests (CI-safe)
npm test -- tests/unit/intelligence-router.test.js tests/unit/ncm-client.test.js

# Integration benchmark (optional Ollama; NCM mock or live)
npm run benchmark:ncm
```

**Promote NCM beyond experimental only if** on the same machine, same task:

1. Latency p50 improves **or** throughput improves **≥ 20%** at equal or better human-rated quality on a fixed prompt set (≥ 10 prompts).
2. Peak RAM does not exceed Ollama headroom budget on Frank.
3. Automatic fallback to Ollama verified (NCM down → LLM answer, no throw).
4. No change to mobile BFF, pairing, or pipeline layer boundaries.

## Merge checklist

- [ ] Official `evaluate.py` pass on chosen checkpoint (quality baseline)
- [ ] `npm run benchmark:ncm` artifact attached to PR
- [ ] `HYDI_NCM_ENABLED` remains **unset** in `ecosystem.config.js` / PM2 prod env
- [ ] Inference route registry documents `HYDI_NCM_EXPERIMENTAL` surface only
- [ ] RFC if promoting to default router for any production surface

## Security

- Sidecar binds **loopback** by default (`HYDI_NCM_BIND=127.0.0.1`).
- Not exposed via Tailscale serve or public ingress.
- No secrets in NCM requests; checkpoints are local paths only on Frank.