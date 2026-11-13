# PHONE_AUDIT — Phase 0 ground truth (Termux edge)

**Status:** Repository audit complete · **live device state not collected from this cloud agent**  
**Branch:** `phone-edge/phase-0` (Phase 0 deliverable)  
**Auditor context:** Cursor cloud VM · cannot reach the Samsung Termux node ([docs/TERMUX_ANDROID_RECOVERY.md](../TERMUX_ANDROID_RECOVERY.md))

Run on the phone to replace the “pending live” sections with device truth:

```bash
cd ~/HYDI-System-v2 && git pull origin clean-main
mkdir -p ~/hydi/logs
sh termux/phone-audit-phase0.sh | tee ~/hydi/logs/phone-audit-latest.txt
hydi-doctor    # optional; same probes, human-oriented
```

Paste `~/hydi/logs/phone-audit-latest.txt` into the PR or issue when reviewing Phase 0.

---

## 1. What should be running (repo canonical)

| Component | Mechanism | Port | Source |
|-----------|-----------|------|--------|
| **hydi-daemon** | runit `sv` → `hydi.py server` | **3006** | `termux/services/hydi-daemon/run` |
| **hydi** (not the UI) | runit → `llama-server` (llama.cpp) | **8080** | `termux/services/hydi/run` |
| **hydi-chat** (optional) | manual `node termux/hydi-chat-server.js` | **8787** default | `termux/README.md` |
| Local **Ollama** (optional) | not the `hydi` runit service | **11434** | docs; competes with llama.cpp for RAM |

Install path: `sh termux/install-services.sh` copies `termux/services/*` → `$PREFIX/var/service/`.

**Live verification:** _pending_ — run `phone-audit-phase0.sh` on device.

### Expected vs stale port folklore

| Port | Doc / note | Repo verdict |
|------|------------|--------------|
| 3006 | hydi.py PWA | **Canonical on phone** |
| 3006 | Heidi mobile on Frank | Same port number, **different machine** — easy to confuse |
| 8080 | llama.cpp | **Canonical local inference backend** |
| 11434 | Ollama | Optional on phone; **Frank thin-client target** |
| 5056 | “not chat UI” (`termux/README.md`) | Legacy mention; not in runit defs |
| 8765–8767 | Termux-era services | **Dead on Frank** per `docs/DISCREPANCIES.md`; nothing in current `termux/services/` |
| 3003 / 3005 | hydi-processor / protoforge-core | **PC-only** for full pipeline |

---

## 2. Inference stack — conflicting notes

| Claim | Where it appears | Repo ground truth |
|-------|------------------|-------------------|
| Ollama `llama3.2:1b` on phone | Older ops notes, PC Ollama defaults | Phone `hydi` runit service is **llama.cpp**, default model path `~/models/mistral-7b.Q4_0.gguf` (`termux/services/hydi/run`) |
| llama.cpp mistral-7b on :8080 | Later checks, doctor | **Matches** installed service definition |
| Groq cloud fallback | `hydi.py` `GROQ_API_KEY` path | **Conflicts with $0 phone-edge goal** — still in code as priority #1 if key set |
| Frank `qwen2.5:3b-instruct-q4_K_M` | Thin-client scripts | Intended remote model when `OLLAMA_URL` points at Frank |

**Decision for Phase 1 (preview):** one path — prefer **thin-client → Frank Ollama** or smallest stable local GGUF; 7B local often OOMs on SM-class devices (`hydi-doctor.sh` OOM check).

**Phantom process killer:** Android can stop child `llama-server` / `ollama` processes. Mitigation is documented for **Frank/adb only** (not from phone):

```bash
adb shell settings put global settings_enable_monitor_phantom_procs false
```

(`scripts/termux/README.md` — do not run adb from Termux without USB debugging.)

**Live verification:** _pending_ — audit script reports `:8080` vs `:11434`, `ps` lines, and `settings_enable_monitor_phantom_procs` when `settings` exists.

---

## 3. `~/hydi/` file map

The repo’s `setup.sh` only copies a **minimal** set into `~/hydi/`:

- `hydi.py`, `hydi-mobile-protoforge.html`, `manifest.json`, `sw.js`

It does **not** install mesh / bridge Python modules. The runit **hydi-daemon** prefers `$HOME/HYDI-System-v2/hydi.py`, then falls back to `$HOME/hydi/hydi.py`.

| File | In repo? | Intended role | Service reference |
|------|----------|---------------|-----------------|
| `hydi.py` | **Yes** (root) | Phone PWA + CLI | **hydi-daemon** |
| `hydi-mobile-protoforge.html` | Yes | PWA shell | served by hydi.py |
| `server.py` | **No** | Unknown / legacy phone copy | none in repo |
| `hydi_event_hub.py` | **No** | Legacy mesh | none |
| `hydi_bridge.py` | Apex archive only | PC/Apex outbox spec | not phone runit |
| `hydi_guard.py` | **No** | Legacy | none |
| `hydi_mobile.py` | **No** | Legacy | none |
| `mesh_client.py` | **No** | Legacy | none |
| `ursula_event_bridge.py` | **No** | Legacy | none |
| `start_hydi.sh` | Phone path `~/.termux/boot/` | Boot hook | not under `~/hydi/` |
| pre-knowledge backup | Phone-only | Operator backup | n/a |

**Classification rule for Phase 0:** anything not in repo and not referenced by `$PREFIX/var/service/*/run` should be treated as **dead or operator-local** until the audit script shows otherwise.

**Live verification:** _pending_ — `phone-audit-phase0.sh` lists presence, size, and backup-like filenames.

---

## 4. Frank IP / reachability

| Mechanism | Path | Notes |
|-----------|------|-------|
| `FRANK_HOSTS` / `FRANK_IP` | `~/.hydi/thin-client.env` | **Canonical** — read by `hydi.py`, `hydi-doctor.sh`, thin-client scripts |
| `FRANK_IP` | `~/.hydi.env` | Used by `scripts/termux/thin-client.sh` (LAN); easy to diverge from `thin-client.env` |
| Hardcoded `192.168.1.100` | `~/.termux/boot/start_hydi.sh` (if unmigrated) | Flagged in `docs/DISCREPANCIES.md`; `termux/setup-thin-client.sh` patches toward MagicDNS |
| Code default | none for IP | `hydi.py` uses env only — no baked-in 192.168.1.100 |

Preferred tailnet target (docs): `heidi-pc.tailc50af2.ts.net` (`docs/TAILSCALE.md`).

**Live verification:** _pending_ — audit probes `FRANK_IP:11434/api/tags` and greps boot/env files for `192.168.1.100`.

---

## 5. termux-wake-lock and Termux:Boot

| Item | Repo expectation |
|------|------------------|
| `termux-wake-lock` | Recommended before long-running inference (`termux/README.md`); doctor inspects `/sys/power/wake_lock` |
| **Termux:Boot** | Separate APK (`com.termux.boot`), **not** `pkg install`; hooks live in `~/.termux/boot/*.sh` |

**Live verification:** _pending_.

---

## 6. Dead, contradictory, or out-of-scope (do not fix in Phase 0)

### Contradictions (docs vs repo vs notes)

1. **Two inference stories** — Ollama `llama3.2:1b` vs llama.cpp `mistral-7b` on :8080 (§2).
2. **Two Frank env files** — `~/.hydi/thin-client.env` vs `~/.hydi.env` (§4).
3. **Port 3006 collision** — phone `hydi.py` vs Frank `heidi-mobile-chat` (§1).
4. **~/hydi mesh Python files** — named in operator runbooks but **absent from repo** (§3).
5. **`HYDI_MODE=local|frank`** — requested in Phase 2; **not implemented** in `hydi.py` yet (Frank hosts use `FRANK_HOSTS` / `OLLAMA_URL` only).
6. **Groq first in `hydi.py`** — violates $0 constraint when a key is present.
7. **Supabase service-role on phone** — `termux/setup-termux-chat.sh` path; thin-client docs say remove keys once relay works.
8. **Ursula / Vercel / Galactic Bytes / Supabase schema / heidi-core / PC Steward** — **out of scope** for phone-edge work; Frank spine on `heidi-spine/phase-N` owns those.

### Explicitly dead (Frank audit 2026-11-07)

- Ports **8765–8767** — no listeners on Frank; not in current phone runit (`docs/DISCREPANCIES.md`).

### Dependencies on Frank (note only)

- Phase 2 **frank** mode: Frank Ollama `qwen2.5:3b-instruct-q4_K_M` on LAN **11434** and a **Heidi `/status` (or equivalent) endpoint** — not verified here; parallel `heidi-spine` work.
- Phase 3 life collector sync — requires reachable `FRANK_IP` only; no cloud APIs.

---

## 7. Cloud-agent verification log (this session)

| Check | Result |
|-------|--------|
| `termux/phone-audit-phase0.sh` syntax (`sh -n`) | Run in CI via unit test |
| `termux/services/hydi` + `hydi-daemon` definitions | Present; llama.cpp + hydi.py |
| `scripts/hydi-doctor.sh` | Covers sv, ports, Ollama, Frank hosts, wake-lock |
| Live Termux services / ports / RAM | **NOT RUN** (no device path from cloud) |
| Live Frank / phone LAN | **NOT RUN** |

---

## 8. Review gate

Phase 0 is **complete for repo-side audit** when this document and `termux/phone-audit-phase0.sh` are merged. Phase 1 should **not** start until a maintainer attaches **live** `phone-audit-latest.txt` (or confirms the phone matches §1–5).

**Reviewer checklist**

- [ ] `sv status` for every service under `$PREFIX/var/service/`
- [ ] Which inference endpoint actually answers chat (`/api/models` on :3006)
- [ ] Whether `192.168.1.100` still appears in boot scripts
- [ ] Whether `~/hydi/*.py` mesh files exist or can be deleted/archived
