# Termux phone thin client (Phase 5)

Scripts for configuring a Termux phone to use Frank's Ollama when reachable, with a local llama-server fallback. No device-side sqlite3; no multi-line heredocs in the install path.

## One-line install

Replace `clean-main` with your branch if you are testing a PR:

```bash
curl -fsSL https://raw.githubusercontent.com/waveformer1984/HYDI-System-v2/clean-main/scripts/termux/thin-client.sh -o ~/thin-client.sh && bash ~/thin-client.sh
```

## Prerequisites on the phone

1. Create `~/.hydi.env` with Frank's address (MagicDNS or LAN), for example:

   ```bash
   printf 'FRANK_IP=heidi-pc.tailc50af2.ts.net\n' >> ~/.hydi.env
   ```

   The script **fails loudly** if `FRANK_IP` is unset — it does not assume `192.168.1.100`.

2. `thin-client.sh` health-checks `http://$FRANK_IP:11434/api/tags`, then exports:

   - `OLLAMA_URL=http://$FRANK_IP:11434`
   - `OLLAMA_MODEL=qwen2.5:3b-instruct-q4_K_M`

   If Frank is down, it falls back to `HYDI_LLAMA_URL=http://127.0.0.1:8080` when local llama-server answers.

## ADB phantom-process fix (run from Frank / dev PC)

Android 12+ can kill background Termux workers. From a machine with ADB to the phone:

```bash
adb shell settings put global settings_enable_monitor_phantom_procs false
```

Run once per device; revert with `true` if you need stock behavior.

## Related

- Full tailnet setup: `termux/setup-thin-client.sh` at repo root (HTTPS Ollama serve, boot script patches).
- Architecture: `termux/README.md`, `docs/TAILSCALE.md`.
