# NCM inference service (experimental)

Isolated Python HTTP service for [Stanford Hazy Research NCM](https://github.com/HazyResearch/ncm). **Not** started by `npm run boot`. Ollama remains the production local LLM until benchmark gates pass.

## Quick start (mock — no GPU)

```bash
cd services/ncm-inference
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
HYDI_NCM_MOCK=1 python -m app.main
curl -s http://127.0.0.1:8791/health
```

## Official checkpoints (Frank / GPU machine)

1. Clone `https://github.com/HazyResearch/ncm` and `pip install -r requirements.txt` (CUDA PyTorch).
2. Download weights: `hf download hazyresearch/ncm-checkpoints --local-dir artifacts`
3. Run official baseline first: `python evaluate.py --config config/eval/xsum.yaml ...`
4. Point this service: `export HYDI_NCM_CHECKPOINT_DIR=/path/to/artifacts/xsum` and `HYDI_NCM_MOCK=0`

Until `OfficialNcmBackend.generate` is wired, use upstream `evaluate.py` for quality scoring.

## HYDI env

| Variable | Default | Purpose |
|----------|---------|---------|
| `HYDI_NCM_ENABLED` | off | Allow intelligence router to select NCM |
| `HYDI_NCM_SERVICE_URL` | `http://127.0.0.1:8791` | Sidecar base URL |
| `HYDI_INTELLIGENCE_ROUTER` | off | Set `1` to enable router in `ModelManager` |
| `HYDI_ROUTER_TASK` | — | e.g. `planning` (must be NCM-eligible) |

See `docs/NCM_EXPERIMENTAL_INTEGRATION.md` for merge gates.