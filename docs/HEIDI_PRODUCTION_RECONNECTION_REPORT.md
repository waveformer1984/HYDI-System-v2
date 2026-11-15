# HEIDI Production Reconnection Report

**Mission:** Production truth, connectivity, operational verification  
**Generated:** 2026-11-15 (cloud agent, read-only)  
**Repository baseline:** `waveformer1984/HYDI-System-v2` @ `clean-main` **`c881f0c1`** (PR #598 merged; feature `1480faab`)  
**Evidence rule:** Classifications on every finding; **Frank live state is UNKNOWN** until operator/collector evidence.

---

## 1. Executive summary

| Question | Answer (evidence class) |
|----------|-------------------------|
| What works? | **GitHub CI** on merged `1480faab`; **repository** mobile BFF + pairing design are coherent; **documented** Tailscale path `https://heidi-pc.tailc50af2.ts.net/heidi` → `:3000`. |
| What is broken? | **Unknown on Frank** (no live probes). **Cloud → Frank** path is **BLOCKED** (no worker, no tailnet DNS from agent VM). |
| What is disconnected? | This cloud agent from Frank; phone production URL **unconfirmed**; pairing/session/chat **unverified live**. |
| Repo vs production | **#598 merged ≠ deployed** on Frank until `frank-auto-deploy` (or manual) applies `c881f0c1` and PM2 uses that tree. |

**Single highest-impact next action:** On Frank (or from phone on tailnet), produce **timestamped** `GET /api/heidi-mobile/session` JSON from the **same host** the phone uses — then run `scripts/frank-production-truth-collect.ps1` and attach JSON (no secrets).

---

## 2. Current verified architecture (repository)

### Phone-first path (canonical design)

- **UI:** `pages/heidi.tsx` → PWA at **`/heidi`** on **heidi-web** (port **3000**).
- **BFF:** `pages/api/heidi-mobile/*` — session, status, brief, tasks, chat, events, ops, fabric.
- **Upstream (device HMAC):** `lib/heidi-mobile/hydiClient.js` → `HYDI_API_URL` or default `http://127.0.0.1:3000`.
- **Heidi-core (missions, morning brief, chat-tools):** port **3459** via `lib/heidi-mobile/heidiCore.js` (`HEIDI_CORE_URL`, optional `x-heidi-secret`).
- **Pairing:** `HYDI_SERVICE_SECRET` seals cookie; devices via `/api/devices`; approval via `/api/status/system` probe.

**Classification:** VERIFIED REPOSITORY (not live on Frank).

### Parallel / legacy surfaces (do not assume interchangeable)

| Surface | Port | Role | Classification |
|---------|------|------|----------------|
| heidi-web `/heidi` | 3000 | **Primary mobile PWA** + BFF | VERIFIED REPOSITORY |
| `heidi-mobile-chat` (`launch-heidi-mobile.js`) | 3006 | Legacy LAN chat; `HEIDI_MOBILE_REQUIRE_TOKEN` | VERIFIED REPOSITORY |
| GitHub Pages `docs/index.html` | pages | Static shell; user supplies API URL + secret in UI | VERIFIED REPOSITORY; live URL **UNKNOWN** (404 probed from cloud) |
| Walkie Funnel | 8443 | Public exception; not Heidi mobile | VERIFIED REPOSITORY |
| `hydi-mobile-protoforge.html` | — | Legacy HTML client | VERIFIED REPOSITORY |

---

## 3. Service and port inventory (Frank expected)

Sources: `boot.config.json`, `ecosystem.config.js`, `docs/PORTS.md`, `docs/TAILSCALE.md`.

| Service | PM2 / boot | Port | Health | Auth | Live on Frank |
|---------|------------|------|--------|------|---------------|
| protoforge-core | boot / PM2 | 3005 | `/health` | varies | **UNKNOWN** |
| heidi-web (dev) or heidi-web-standalone (prod) | boot / PM2 | 3000 | `/api/health`, `/api/ping` | public + device routes | **UNKNOWN** |
| heidi-core | PM2 `heidi-core` | 3459 | heidi-core routes | `x-heidi-secret` off-loopback | **UNKNOWN** |
| heidi-mobile-chat | boot optional | 3006 | `/api/health` | mobile token | **UNKNOWN** |
| hydi-daemon | PM2 | — | `.heidi-daemon-status.json` | N/A | **UNKNOWN** |
| frank-auto-deploy | PM2 | — | — | — | **UNKNOWN** |
| hydi-local-ci | PM2 | — | GitHub commit statuses | — | **VERIFIED REPOSITORY** (posted failures on PR #598 head from Frank) |
| Ollama | OS | 11434 | `/api/tags` | — | **UNKNOWN** |
| Supabase local | Docker | 54321/54322 | — | JWT | **UNKNOWN** |
| protoforge MCP | task | 3470 → tailnet 8470 | `/healthz` | bearer | **UNKNOWN** |

**Boot authority:** `npm run boot` / PM2 `hydi-boot` reads `boot.config.json` — does **not** start `heidi-core` (PM2 separate).

---

## 4. Mobile connection architecture

### Intended production URL (documentation)

| URL type | Example | Phone use |
|----------|---------|-----------|
| **Tailscale (documented)** | `https://heidi-pc.tailc50af2.ts.net/heidi` | PWA + same-origin `/api/heidi-mobile/*` |
| LAN | `http://<pc-lan-ip>:3000/heidi` | Same; HTTPS cookie `Secure` behavior differs |
| GitHub Pages | `https://<user>.github.io/.../docs/` | Must configure API URL + secret in settings — **not** same as tailnet |
| ngrok / public tunnel | `hydi-public-tunnel` (PM2) | Ingress allowlist; customer routes only for most paths |

**Classification:** Tailscale URL = VERIFIED REPOSITORY; **reachability from cloud** = BLOCKED; **your phone’s actual URL** = UNKNOWN.

### Milestones (must be separate)

1. **Configuration:** `session_available: true` ← `HYDI_SERVICE_SECRET` on heidi-web.
2. **Pairing:** HttpOnly `heidi_session` cookie; POST pair/request outcomes.
3. **Approval:** `/api/status/system` with device token (status + chat).
4. **Status:** `GET /api/heidi-mobile/status` → `checked_at`, per-source `errors`.
5. **Brief:** `GET /api/heidi-mobile/brief` → heidi-core `/morning-brief` (**3459**).
6. **Tasks:** `GET /api/heidi-mobile/tasks` → HYDI APIs + heidi-core missions.
7. **Chat:** `POST /api/heidi-mobile/chat` → `/api/chat` SSE + `ensureDeviceApproved`.

---

## 5. Authentication and pairing analysis

| Mechanism | Location | Proves | Does not prove |
|-----------|----------|--------|----------------|
| `session_available` | GET session, unpaired | BFF has `HYDI_SERVICE_SECRET` | Upstream, pairing success |
| `paired: true` (GET session) | Cookie valid | Local session sealed | Current device approval (see `pending_at_pairing`) |
| Device HMAC | `x-hydi-device-token` | HYDI device registry | heidi-core up |
| `ensureDeviceApproved` | chat route | Live `/api/status/system` ≤60s cache | Chat model/stack health |

**Security note (repository):** `POST /api/chat` is intentionally unauthenticated for desktop — gated on mobile only in BFF. Classification: VERIFIED REPOSITORY.

---

## 6. Production connectivity findings

| Path | Result | Classification |
|------|--------|----------------|
| Cloud agent → `heidi-pc.tailc50af2.ts.net` | DNS/connect failed | BLOCKED |
| Self-hosted Cursor worker on Frank | None registered | BLOCKED |
| `TS_AUTHKEY` / tailnet join | Not used (no new credentials) | BLOCKED by policy |
| PROTOFORGE MCP :8470 | Documented; cloud cannot reach | BLOCKED |
| GitHub Actions | CI only; no Frank SSH | VERIFIED CLOUD |
| `local-ci/*` statuses | Posted from Frank PM2; failed on some SHAs | HISTORICAL / partial |

### Minimal Frank diagnostic (operator, read-only)

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank-production-truth-collect.ps1
```

Output: `.runtime\production-truth\frank-production-truth-<timestamp>.json` (`schema_version: 1`). Attach file to agent run — **no secrets in file** (env key names only).

Optional phone-browser (tailnet, secrets not in URL):

`https://heidi-pc.tailc50af2.ts.net/api/heidi-mobile/session`

---

## 7. Independent functionality test matrix

All live rows **BLOCKED** until Frank or phone evidence. Endpoints are **VERIFIED REPOSITORY**.

| ID | Test | Endpoint / command | Expected (summary) | Actual | Result | Evidence |
|----|------|-------------------|-------------------|--------|--------|----------|
| A | System status | GET `/api/heidi-mobile/status` (paired) | 200, `checked_at`, `state` | — | **BLOCKED** | — |
| B | Session config | GET `/api/heidi-mobile/session` | `session_available` | — | **BLOCKED** | — |
| C | Pairing | POST session `request` | cookie, `approved: false` until owner | — | **BLOCKED** | — |
| D | Mobile auth | status + system probe | device accepted | — | **BLOCKED** | — |
| E | Chat | POST `/api/heidi-mobile/chat` | SSE ends with `done` | — | **BLOCKED** | — |
| F | Memory | heidi-core SQLite / chat history | persistence across restart | — | **BLOCKED** | — |
| G | Tasks | GET `/api/heidi-mobile/tasks` | sections `ok` or explicit errors | — | **BLOCKED** | — |
| H | Orchestration | hydi-daemon + missions | lifecycle transitions | — | **BLOCKED** | — |
| I | Notifications | activity BFF | shaped feed | — | **BLOCKED** | — |
| J | Events SSE | GET events | relay, 5m cap | — | **BLOCKED** | — |
| K | Backends | :3000/:3005/:3459/:54321 | health endpoints | — | **BLOCKED** | collector |
| L | Resources | CPU/RAM/disk/GPU | thresholds in frank-host | — | **BLOCKED** | collector |

**Cloud VM (not Frank):** partial probes on dev `:3000` — **VERIFIED CLOUD**, **HISTORICAL** for this mission.

---

## 8. Agent autonomy assessment

**Mission lifecycle (repository):** `heidi-core/missions/lifecycle.js` — QUEUED → … → COMPLETED; human approve for state-changing actions. **Classification:** VERIFIED REPOSITORY.

**Phone execution path:** Tasks approve → HYDI actions / heidi-core `decideMission`; autonomous execution gated by `HEIDI_AUTONOMOUS_ACTIONS`, bounds, etc. **Live:** UNKNOWN.

**False-success risks:** pairing cookie without approval; status page load without `checked_at`; queued mission ≠ executed; CI green ≠ Frank running `c881f0c1`.

---

## 9. Resource utilization assessment

Frank collector script gathers CPU/RAM/disk/GPU, PM2 restarts, Ollama models. **No live numbers in this report.** Classification: BLOCKED.

Repository concerns (non-destructive): `frank-auto-deploy` RAM/disk gates; `frank-observer` + fix-list; duplicate forks (documented in CLAUDE.md). **SIMULATED** / VERIFIED REPOSITORY in unit tests only.

---

## 10. Security findings

| Finding | Severity | Classification |
|---------|----------|----------------|
| Unauthenticated `/api/chat` for non-mobile callers | Known, documented | VERIFIED REPOSITORY |
| Operations snapshot requires `x-heidi-secret` (#598) | Hardening merged, deploy UNKNOWN | VERIFIED REPOSITORY |
| No Funnel except walkie :8443 | Policy | VERIFIED REPOSITORY |
| Cloud agent has no Frank credentials | Correct posture | VERIFIED CLOUD |

---

## 11. Exact blockers

1. **No live Frank inventory** after your pre-work changes.  
2. **Phone-facing URL unconfirmed** (tailnet vs Pages vs tunnel).  
3. **No paired device evidence** from production host.  
4. **Cloud cannot reach Frank** without tailnet worker or attached collector JSON.

---

## 12. Prioritized recovery plan

| Priority | Action | Where | Approval |
|----------|--------|-------|----------|
| P0 | Paste session JSON from phone browser | Phone | User |
| P0 | Run production truth collector | Frank | User |
| P1 | Confirm `git rev-parse HEAD` on Frank tree vs `c881f0c1` | Frank | User or `git.inspect` mobile-ops |
| P1 | Pair / approve device if `session_available` && not paired | Phone + owner | User |
| P2 | Verify status → brief → tasks → chat in order | Phone | User |
| P2 | If heidi-core down, restart **one** module | Frank | **Explicit approval** |
| P3 | Align `hydi-local-ci` failures on new main | Frank | Optional |

**No new infrastructure PRs** until P0–P2 evidence exists.

---

## 13. Acceptance criteria (mission complete)

- [ ] Frank running services identified (collector JSON).  
- [ ] Real phone URL confirmed.  
- [ ] `session_available` + pairing verified.  
- [ ] Status with `checked_at` and honest `state`.  
- [ ] One read-only op with execution evidence (e.g. brief lines or tasks section `ok: true`).  
- [ ] Chat round-trip (may need explicit approval for inference cost).  
- [ ] Memory/task/agent paths verified independently.  
- [ ] Resource snapshot from Frank, not cloud.

---

## 14. Bounded follow-ups (out of scope for reconnection)

- Replace `-x inbucket` with `-x mailpit` in `hdi-governance-gate.yml`, `.cursor/cloud-agent-start.sh` (CI parity; #598 fixed only `unit-tests.yml`).

---

## Appendix — Component map (quick reference)

| Concern | Primary files |
|---------|----------------|
| Mobile BFF | `pages/api/heidi-mobile/*`, `lib/heidi-mobile/*` |
| Pairing | `pages/api/heidi-mobile/session.js`, `lib/heidi-mobile/session.js` |
| Device auth | `lib/auth/deviceAuth.js`, `lib/auth/requireAuth.js` |
| Chat | `pages/api/heidi-mobile/chat.js`, `pages/api/chat.ts` |
| heidi-core | `heidi-core/server.js`, PM2 `heidi-core` |
| Boot | `scripts/boot-agent.js`, `boot.config.json` |
| Deploy | `scripts/frank-auto-deploy.js`, PM2 `frank-auto-deploy` |
| Tailscale | `docs/TAILSCALE.md`, `scripts/tailscale/*` |
| Truth collector | `scripts/frank-production-truth-collect.ps1` |