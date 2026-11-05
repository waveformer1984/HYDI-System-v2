# Termux phone thin client (Phase 5)

Single script: **`thin-client.sh`**. Probe order is **tailnet HTTPS → LAN `FRANK_IP` → local llama-server (`127.0.0.1:8080`)**.

Legacy path `termux/setup-thin-client.sh` forwards here with `--apply` (boot/env writes).

## One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/waveformer1984/HYDI-System-v2/clean-main/scripts/termux/thin-client.sh -o ~/thin-client.sh && bash ~/thin-client.sh --apply
```

## Configuration

1. **Tailnet (preferred):** Tailscale connected; Frank serves Ollama on `:11434` (see repo `docs/TAILSCALE.md`).
2. **LAN fallback:** create `~/.hydi.env` with `FRANK_IP=<host or IP>` — **required for LAN**; the script does not assume `192.168.1.100`.
3. **Local fallback:** hydi/llama-server on port **8080**.

Remote model default: `qwen2.5:3b-instruct-q4_K_M`.

## Options

```bash
bash ~/thin-client.sh --apply --disable-local-llm   # write env + boot patch + stop local LLM
bash ~/thin-client.sh --dry-run --apply             # preview
bash ~/thin-client.sh --pc heidi-pc.tailc50af2.ts.net --apply
```

Without `--apply`, the script only probes and prints `export …` lines.

## ADB phantom-process fix (run from Frank / dev PC)

```bash
adb shell settings put global settings_enable_monitor_phantom_procs false
```

## Related

- `termux/README.md` — full Termux stack
- `docs/TAILSCALE.md` — serve Ollama on the tailnet
