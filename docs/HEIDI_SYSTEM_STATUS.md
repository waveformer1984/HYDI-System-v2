# HYDI system status and mobile device login

Two operational pieces for Heidi:

- **A unified system status.** It reports whether each part of HYDI is
  actually working, not just whether its port answers.
- **A device login for the mobile chat server on :3006.** Saved conversations
  can only be read from a paired device.

## System status

Ask Heidi any of these in chat:

- `system report`
- `status report`
- `health report`
- `/status`
- `full status`

The 📊 Status and 🔧 Health check buttons send `system report`, and the old
`status` / `health` fast path now uses the same report. You can also call
`GET /system/status` on heidi-core (same auth as every route), or
`GET /api/system/status` through the mobile relay.

The full report needs no model call. On the HTTP route it returns `503` when
the overall state is UNAVAILABLE.

Each component gets one state:

| State | Meaning |
|---|---|
| HEALTHY | it answered **and** did its job |
| DEGRADED | it answered, but something about it is wrong |
| UNAVAILABLE | it could not be reached (with timeouts, 4s by default) |
| UNKNOWN | no fresh evidence: a status file is missing or stale |

| Component | Evidence | HEALTHY only when |
|---|---|---|
| heidi-core | this process | it is answering |
| memory | rolled-back write on `heidi_memory.db` | the write succeeds; DEGRADED if the legacy store (agents, missions) fell back to RAM |
| local-model | `GET {OLLAMA_URL}/api/tags` | at least one model is listed |
| heidi-web | `/api/ping`, then `/api/health` | it is alive **and** reports `healthy` |
| mobile-chat | `:3006/api/health` | it answers 2xx |
| protoforge-core | `:3005/health` | it reports `ok` |
| database | `.heidi-daemon-status.json` persistence probe (≤ 3 min old) | Postgres **and** Supabase REST are `ok` |
| execution-daemon | same file | fewer than 3 consecutive failed cycles |
| frank-host | `.runtime/observation/frank.json` (≤ 5 min old) | level OK; otherwise its top issues are listed |
| auth | environment | `HEIDI_MOBILE_TOKEN` is set |
| recent-failures | Heidi's mission queue | no failed missions in 24h |

**Overall state:**

- UNAVAILABLE when memory or the local model is unreachable, because Heidi
  can't work without them.
- Otherwise HEALTHY only if every component is HEALTHY.
- In every other case, DEGRADED.

Code: `heidi-core/status/system-status.js`. Tests:
`tests/unit/heidi-system-status.test.js`.

## Mobile chat device login (`HEIDI_MOBILE_TOKEN`)

`launch-heidi-mobile.js` (:3006) serves the Heidi chat to the LAN and the
tailnet, and relays conversation history. Until now anyone who could reach
the port could read it.

**Turning it on:**

1. Pick a long random token on Frank and set `HEIDI_MOBILE_TOKEN` in its
   environment (for example `.env.local`). It must be at least 12 characters.
2. Restart the `heidi-mobile-chat` module.

**What happens once it's set:**

- **Requests from Frank itself pass.** That means a loopback socket with
  **no** forwarding headers. Traffic from `tailscale serve` or any other
  reverse proxy also arrives on loopback, but it carries `X-Forwarded-For` or
  `Tailscale-User-Login`, so it has to log in like any other device.
- **Other devices get `401 login_required`** on every `/api/*` route, except
  `/api/health`, `/api/pair` and the Forge Board (which has its own tokens).
  - The page asks for the token once.
  - It POSTs the token to `/api/pair`.
  - The server sets an `HttpOnly; SameSite=Strict` cookie, valid 90 days.
  - The cookie holds a digest derived from the token, never the token itself.
- **Scripts can send `Authorization: Bearer <token>`** instead.
- **Pairing is limited to 10 attempts per minute** per address.
- **Rotating the token signs every device out.**

Leaving it unset keeps the old open behaviour, and the system report marks
`auth` as DEGRADED.

Code: `lib/mobile-chat/local-auth.js`. Tests:
`tests/unit/mobile-chat-local-auth.test.js`.

## Baseline when this was written (2026-10-28)

Verified from this repository and GitHub, not from running services on Frank:

- **`clean-main` is at `47c6a49`** (#460, Heidi persistent memory). Unit,
  integration and CodeQL checks are green.
- **The GitHub Pages deploy (`deploy-pages.yml`) has failed on every run
  since at least 2026-10-25** with "Get Pages site failed: Not Found". Pages
  isn't enabled for the repo, so the static mobile client in `docs/` isn't
  published. Fix it by hand: either enable Pages (Settings → Pages → Source:
  GitHub Actions) or disable the workflow.
- **The scheduled Health Monitor workflow is failing.** Its cause hasn't been
  investigated yet.
- **20 PRs are open:** 13 Dependabot bumps, draft #446, and #437, #335, #331
  and #231, which haven't been updated since 2026-10-12 to 2026-10-24.
- **The `heidi-chat-portal` Vercel app** isn't in any repository this
  session can reach.
- **Live behaviour on Frank** (Ollama answering from memory, real health
  values) still needs checking after deploy, with `memory audit` and
  `system report`.

## Not done yet, by priority

1. **The task lifecycle (QUEUED → … → COMPLETED) is not unified.**
   - Heidi's `missions` already cover pending, active, blocked, completed,
     failed and cancelled, gated by the agent permission ladder.
   - HYDI also has human actions, ActionProposals and the CognitiveCore
     decision log.
   - The next step is to extend missions, adding a planning, awaiting-approval
     and verifying step plus success criteria and evidence, rather than
     building a parallel system.
2. **ProtoForge event → task tracing.**
   - `lib/pipeline` already gives every event a `trace_id` through all six
     stages (live via protoforge-core `POST /cascade/event`).
   - Not yet built: a pipeline decision opening a Heidi mission with the same
     correlation id.
3. **A bounded improvement loop:** observe through `system report`, propose a
   mission, require approval, verify. It depends on 1.
