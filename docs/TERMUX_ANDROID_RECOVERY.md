# Android / Termux HYDI recovery

This document is for the **Samsung phone (Termux ARM64)** node. Cursor cloud agents **cannot** reach your device; run commands **in Termux** and paste logs back.

## Port map (do not assume PC layout)

| Service | Typical phone port | Notes |
|---------|-------------------|--------|
| **hydi.py** mobile PWA | **3006** | `hydi-daemon` runit service; `/api/health` |
| **llama.cpp** local inference | **8080** | runit service **`hydi`** — not the chat UI |
| **hydi-chat-server.js** | **8787** (or `PORT`) | Thin Supabase chat |
| **Ollama** | **11434** | `~/.ollama` preserved always |
| **hydi-processor** | **3003** | Usually **PC only** (`hydi-processor.js`) |
| **ProtoForge core** | **3005** | Usually **PC** |
| **Heidi mobile (PC)** | **3006** | Same port number, different process on Frank |

If **3003 is down on the phone**, that may be normal. Open **http://127.0.0.1:3006/** for the hydi.py portal.

## One-command recovery (on phone)

```bash
cd ~/HYDI-System-v2
git pull origin clean-main
sh termux/hydi-recovery.sh              # audit + dry-run cleanup + fix-all + doctor
sh termux/hydi-recovery.sh --apply-storage   # also run safe cache cleanup
```

Report file: `~/.hydi/recovery-*.log`

## Storage incident (103 GB / 917 MB free)

1. **Audit (read-only):** `sh termux/hydi-storage-audit.sh`
2. **Preview cleanup:** `sh termux/hydi-storage-recover.sh --dry-run`
3. **Apply safe caches only:** `sh termux/hydi-storage-recover.sh --apply`

**Never deleted by automation:** `~/.ollama`, `heidi_memory.db`, `.git`, `~/.hydi/thin-client.env`, credentials.

**Target:** recover **5–10 GB** from apt/npm/pip caches and repo `__pycache__` before touching `node_modules` or `.next`.

## HYDI process on 3006 but no HTTP

Common causes:

1. **Wrong process on port** — orphan Python not runsv-managed. Run `termux/hydi-fix-all.sh` (kills non-runsv orphans).
2. **hydi-daemon crash-loop** — `sv status hydi-daemon` + logs under `$PREFIX/var/log/sv/hydi-daemon/`.
3. **Disk full** — server cannot bind or write; fix storage first.
4. **OOM** — llama model larger than free RAM; prefer thin-client to Frank (`termux/setup-thin-client.sh`).

Doctor now probes **`/api/health`** on the dashboard port, not only `/`.

## Ollama restore (existing models)

```bash
termux-wake-lock
sv down hydi 2>/dev/null    # llama.cpp competes for RAM
ollama serve &              # or: sv up ollama if you use a service
sleep 2
ollama list
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:11434/api/tags
```

Do **not** re-download models unless manifests are corrupt (operator decision).

## Thin client (recommended on SM-S711U)

Local Ollama + 7B GGUF often loses to Android memory limits. Prefer Tailscale to Frank:

```bash
bash termux/setup-thin-client.sh --dry-run
bash termux/setup-thin-client.sh --disable-local-llm
sv restart hydi-daemon
```

## Memory search

Phone **hydi.py** PWA may call `/api/memory/search` on **Frank** via `CFG.apiBase` — not local SQLite. Heidi persistent memory lives in **heidi-core** on the PC (`heidi-core/data/heidi_memory.db`). Verify:

- On Frank: `memory audit` in Heidi chat (7/7).
- On phone: memory search only works if `CFG.apiBase` points at an authenticated backend (paired `/heidi` app), not an empty apiBase.

## Security (mobile)

- Do **not** store `HYDI_SERVICE_SECRET` or Supabase service-role keys in browser localStorage on shared devices.
- Device pairing uses HMAC / sealed cookies on **Heidi mobile BFF** — see `docs/HEIDI_MOBILE.md`.
- `/api/keys/status` on hydi.py is **loopback-only** by design.

## Doctor

```bash
ln -sf ~/HYDI-System-v2/scripts/hydi-doctor.sh $PREFIX/bin/hydi-doctor
hydi-doctor
```

On PC/dev: `node scripts/hydi-doctor.js --json`
