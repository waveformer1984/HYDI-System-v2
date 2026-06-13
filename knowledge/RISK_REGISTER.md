# Risk Register — HYDI / ProtoForge Mobile Stack

Last updated: 2026-06-13  
Format: Risk ID | Severity | Status | Description | Mitigation

---

## Security Risks

### R-SEC-01 — Header-based identity (no crypto verification)
- **Severity:** High
- **Status:** Known, unmitigated (documented in CLAUDE.md)
- **Description:** Identity is asserted via `x-user-id` HTTP headers — not cryptographically signed or verified. Any client that can reach the server can spoof identity.
- **Mitigation:** Roadmap item. Short-term: restrict server to LAN only (firewall). Long-term: JWT signed tokens.

### R-SEC-02 — Supabase service role key in .env
- **Severity:** High
- **Status:** Controlled — key is server-side only, never sent to browser
- **Description:** `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS policies. If leaked, full DB access.
- **Mitigation:** Key is only loaded server-side in `launch-heidi-mobile.js`. HTML/frontend never receives it. Do not add `SUPABASE_` vars to any client-side bundle.

### R-SEC-03 — .vapid-keys.json private key on disk
- **Severity:** Medium
- **Status:** Not yet mitigated
- **Description:** Web push VAPID private key is stored in `.vapid-keys.json` in the project directory. Not in `.gitignore` — could be accidentally committed.
- **Mitigation:** Add `.vapid-keys.json` to `.gitignore` immediately. Consider storing key in env vars instead.

### R-SEC-04 — Stripe secret key exposure
- **Severity:** High
- **Status:** Controlled
- **Description:** `STRIPE_SECRET_KEY` in `.env`. If the `.env` file is committed or the process memory is dumped, key is exposed.
- **Mitigation:** `.env` is in `.gitignore`. Key is server-side only. Never log or echo.

### R-SEC-05 — Heidi Bridge SELECT-only enforcement
- **Severity:** Medium
- **Status:** Mitigated
- **Description:** Bridge's `/api/db/query` endpoint accepts SQL from Heidi Mobile. Only SELECT queries are allowed (regex check).
- **Mitigation:** Regex `^SELECT` enforced in both bridge and `query_database` tool handler. No INSERT/UPDATE/DELETE possible via this path.

### R-SEC-06 — Ollama CORS origins wide open
- **Severity:** Low
- **Status:** Acceptable for LAN use
- **Description:** Ollama is configured with broad CORS origins including `http://0.0.0.0:*`. Intentional for LAN access.
- **Mitigation:** Acceptable while server is LAN-only. If exposed to internet, restrict `OLLAMA_ORIGINS`.

---

## Operational Risks

### R-OPS-01 — Ollama not network-accessible by default
- **Severity:** High (blocks phone AI)
- **Status:** Requires manual action on each PC restart
- **Description:** Ollama defaults to `localhost:11434`. Requires `OLLAMA_HOST=0.0.0.0` at startup for phone access.
- **Mitigation:** Set `OLLAMA_HOST` as a permanent Windows system environment variable, or add to `heidi-autostart.ps1`.

### R-OPS-02 — Bridge not auto-starting
- **Severity:** Medium
- **Status:** Partially mitigated
- **Description:** `heidi-bridge.py` must be manually started. If PC reboots, bridge is down.
- **Mitigation:** `heidi-autostart.ps1` was created to register bridge as Task Scheduler job. Needs to be run as Admin once.

### R-OPS-03 — Heidi Mobile not auto-starting
- **Severity:** Medium
- **Status:** Not mitigated
- **Description:** `launch-heidi-mobile.js` must be manually started on PC after reboot.
- **Mitigation:** Can be added to Task Scheduler similar to bridge. Or run via `heidi-start.bat`.

### R-OPS-04 — Web push subscriptions lost on restart
- **Severity:** Low
- **Status:** Known limitation
- **Description:** Web push subscriptions are stored in-memory (`webPushSubs` Map). Server restart clears all subscriptions. Users must re-tap the bell after restart.
- **Mitigation:** Persist subscriptions to Supabase `heidi_push_subscriptions` table (future work).

### R-OPS-05 — Rezonate core not installed
- **Severity:** Low
- **Status:** Open
- **Description:** Bridge reports "Rezonate core: not found". The `get_rezonate_score` tool will return errors.
- **Mitigation:** Clone `waveformer1984/rezonette` repo into `C:\ProtoForge_Ecosystem\`.

### R-OPS-06 — Protohub not running
- **Severity:** Low
- **Status:** Open
- **Description:** Protohub (Node, port 4000) is not currently running. JWT auth and Pro/Enterprise billing features unavailable.
- **Mitigation:** No immediate need. Start when Protohub features are required.

### R-OPS-07 — LAN IP drift
- **Severity:** Medium
- **Status:** Open
- **Description:** PC LAN IP (`192.168.86.82`) may change via DHCP. Hardcoded in `.env` files on phone/Termux.
- **Mitigation:** Set a DHCP reservation for the PC's MAC address in router settings. Or use mDNS hostname.

### R-OPS-08 — UTF-16 .env encoding
- **Severity:** Medium
- **Status:** Mitigated (documented)
- **Description:** PowerShell `echo` and `Set-Content` default to UTF-16 LE, which dotenvx cannot parse (shows "injected env (0)").
- **Mitigation:** Use `Set-Content .env "..."` with backtick-n for newlines, or `[System.IO.File]::WriteAllText(...)` with UTF8 encoding.

---

## Architecture Risks

### R-ARCH-01 — Single AI provider (Ollama on one PC)
- **Severity:** Medium
- **Status:** Acceptable for current scale
- **Description:** All AI inference routes through one Ollama instance on one Windows PC. If PC is off, no AI.
- **Mitigation:** Fallback mode exists in Heidi (returns static responses). Cloudflare tunnel + always-on would mitigate.

### R-ARCH-02 — No multi-step task planner
- **Severity:** Medium
- **Status:** Open (roadmap)
- **Description:** Current dispatch is one-shot: user message → single Ollama call → tool calls → response. No multi-step planning or task decomposition.
- **Mitigation:** Future work: Layer 4 Planner agent (per gap analysis).

### R-ARCH-03 — heidi-bridge.py is a dev Flask server
- **Severity:** Low
- **Status:** Acceptable for LAN use
- **Description:** Flask development server is single-threaded and not production-grade.
- **Mitigation:** For production: wrap with `gunicorn`. For current LAN use: acceptable.

### R-ARCH-04 — No semantic memory / RAG
- **Severity:** Medium
- **Status:** Open (roadmap)
- **Description:** Heidi has no vector store. Cannot recall past sessions beyond the last 40 messages stored in Supabase.
- **Mitigation:** Future: add Qdrant + embeddings to bridge.
