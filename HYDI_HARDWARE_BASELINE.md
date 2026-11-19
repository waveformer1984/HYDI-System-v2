# HYDI hardware baseline

**Audit date (UTC):** 2026-11-19T19:35:00Z  
**Repository:** `waveformer1984/HYDI-System-v2`  
**Git baseline (audit checkout):** `clean-main` @ `06cf644d7325ac8b4488913253de54e02b57fb30`  
**Audit host:** Cursor Cloud agent VM (not Frank, not Android)

---

## Verification methods

| Host | Method | Can cloud agent use it? |
|------|--------|------------------------|
| Cloud audit VM | `free`, `nproc`, `df`, local `npm test` | Yes |
| Frank (`heidi-pc`) | PM2, `frank-observer`, tailnet HTTP | **No** — `docs/PHONE_ACCESS.md` |
| Android Termux | `termux-api`, mic, local Ollama | **No** |
| Supabase production | `verify-supabase.sh`, SQL | **No** in this run — env vars absent on VM |

Cloud agents must **not** claim Frank or phone hardware measurements as verified.

---

## Cloud audit VM (this run)

| Resource | Observed | Notes |
|----------|----------|-------|
| CPUs | 4 | `nproc` |
| RAM | ~15 GiB total, ~4.6 GiB available | Balloon/hypervisor may under-report; not Frank |
| Disk `/` | 254G total, 14G used, 240G free (6%) | Clone workspace only |
| GPU | Not inspected | Not used for local inference on VM |
| Node | ≥22 (per CI) | Used for unit tests only |

**Classification:** N/A (audit tooling host only)

---

## Frank (`heidi-pc` / Windows) — **UNVERIFIED**

**Expected role (from `ecosystem.config.js`, `CLAUDE.md`):** primary production host; PM2 supervises `heidi-web-standalone` :3000, `heidi-mobile-chat` :3006, `heidi-core` :3459, `heidi-agent` :3462, `protoforge-core` :3005, observers, deploy loops.

| Item | Documented expectation | Verified on Frank? |
|------|------------------------|------------------|
| CPU / RAM / disk | `frank-observer` + storage guard | **No** |
| GPU | Optional (Ollama); not required for voice STT CPU | **No** |
| PM2 process list | `npm run runtime:audit` | **No** |
| Ollama :11434 | Local-first inference | **No** |
| Voice STT :9000 / TTS :9001 | `services/voice/` (merged PR #629) | **No** — not in `ecosystem.config.js` |
| Heidi agent health :3462 | Phase 2 persistent loop | **No** |
| Tailscale serve 443 → 3000 | `docs/PHONE_ACCESS.md` | **No** |

**Evidence needed from Jordan:** `.runtime/observation/frank.json` or `GET /api/phone/observe`, `pm2 jlist`, `npm run runtime:audit`, curl `:9000/health` and `:9001/health` on loopback and tailnet.

---

## Android Termux — **UNVERIFIED**

| Item | Expected | Verified? |
|------|----------|-----------|
| Storage / RAM | Phone hardware | **No** |
| `termux-api` / mic | `heidi_voice.py` | **No** |
| Local llama.cpp :8080 | `HYDI_LLAMA_URL` fallback | **No** |
| `FRANK_IP` (e.g. `heidi-pc.tailc50af2.ts.net`) | Thin client env | **No** |
| Ollama on phone | Optional; not primary path | **No** |

**Evidence needed:** `termux/phone-audit-phase0.sh` output, one `python3 heidi_voice.py` round trip + intentional fallback run.

---

## Network paths (design, not live-probed from cloud)

| Path | Purpose |
|------|---------|
| Phone → `https://heidi-pc.tailc50af2.ts.net` | PWA `/heidi`, BFF `/api/heidi-mobile/*` |
| Phone → `http://$FRANK_IP:9000/9001` | Voice STT/TTS (when `VOICE_BIND` set on Frank) |
| Frank → local Postgres / Supabase | Data plane |
| Frank → Ollama :11434 | Primary LLM ($0) |

---

## Concurrent model budget (Frank)

**Not measured in this audit.** Roadmap item: on Frank, record `free` RAM/CPU during `heidi-web` + `heidi-agent` + Ollama + voice services before enabling additional local models or NCM.

**Policy (repo):** `HYDI_ALLOW_PAID_LLM` defaults off (`lib/cost/paid-llm-gate.js`); no large model downloads without explicit budget (`MASTER DIRECTIVE`).