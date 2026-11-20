# Ollama headroom on Frank ($0)

Heidi’s local brain on Frank is **Ollama** on `127.0.0.1:11434`, default model `qwen2.5:3b-instruct-q4_K_M`. These USER-level variables reduce RAM pressure without paid services.

## 1. Set env (Jordan on Frank)

Dry-run first (default):

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank\set-ollama-env.ps1
```

Apply:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank\set-ollama-env.ps1 -Apply
```

The script **does not** restart Ollama. After `-Apply`, restart serve yourself (tray app exit/start, or PM2 `ollama-serve` / `scripts/ollama-serve.js`).

| Variable | Value | Why |
|----------|-------|-----|
| `OLLAMA_FLASH_ATTENTION` | `1` | Enables flash attention (required for q8 KV cache) |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | ~half KV RAM vs default, tiny quality hit |
| `OLLAMA_NUM_PARALLEL` | `1` | One generation slot |
| `OLLAMA_MAX_LOADED_MODELS` | `1` | No second model resident |
| `OLLAMA_KEEP_ALIVE` | `10m` | Unload weights after idle |

## 2. Verify

```powershell
npm run doctor
```

Look for **Ollama memory env** (PASS when all five match), **Ollama ps** (SIZE + ctx), and **Frank RAM / GPU**.

## 3. Align PM2 launcher (optional)

`scripts/ollama-serve.js` already sets parallel/max-loaded; after MemoryOps env is on USER, restart via PM2 so the serve process inherits USER vars. Consider aligning `OLLAMA_KEEP_ALIVE` and adding flash/KV vars in `ollama-serve.js` in a follow-up PR.

## 4. Boot order

Run `set-ollama-env.ps1 -Apply` once, restart Ollama, then `start-heidi-everything.ps1` / PM2 as usual. No change to ports `3006`, `3456`, `3459`, or `3462`.