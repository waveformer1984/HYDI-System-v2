# Heidi Mobile

`/heidi` is the phone-first chat and control surface for HYDI: Chat, Status,
Tasks (approvals + agent work) and Control, installable on Android as a PWA.
It is served by the existing `heidi-web` Next.js process (port 3000). It adds
no second backend; every read and write goes to HYDI's existing,
authenticated APIs.

## Architecture

```
Phone (/heidi, PWA)                     Heidi server (Next.js, same origin)            HYDI
┌──────────────────────┐  cookie only  ┌─────────────────────────────────────┐  x-hydi-device-token  ┌────────────────────────┐
│ Chat Status Tasks    │──────────────▶│ /api/heidi-mobile/*  (BFF)           │──────────────────────▶│ /api/chat              │
│ Control              │  SSE / JSON   │  guard: CSRF, rate limit, session    │   HMAC per request    │ /api/status/system     │
│ localStorage: saved  │◀──────────────│  hydiClient: timeout, classify, sign │◀──────────────────────│ /api/health            │
│ copies + prefs only  │               │  normalize: validate upstream shapes │                       │ /api/actions[/:id]     │
└──────────────────────┘               └─────────────────────────────────────┘                        │ /api/work-sessions     │
                                                                                                       │ /api/agent-manager/... │
                                                                                                       │ /api/notifications     │
                                                                                                       │ /api/events/stream     │
                                                                                                       │ /api/devices           │
                                                                                                       └────────────────────────┘
```

| Phone route (BFF) | Upstream HYDI route(s) | Notes |
|---|---|---|
| `GET/POST/DELETE /api/heidi-mobile/session` | `/api/status/system` (probe), `/api/devices` (register) | Pair, request access, unpair |
| `GET /api/heidi-mobile/status` | `/api/health` + `/api/status/system` | Single truthful `state` |
| `GET/POST /api/heidi-mobile/tasks` | `/api/actions`, `/api/work-sessions`, `/api/agent-manager/control`; `POST /api/actions/:id` | Approve / reject |
| `GET /api/heidi-mobile/activity` | `/api/notifications` | Briefing feed (no model summarisation) |
| `POST /api/heidi-mobile/control` | `POST /api/agent-manager/control` | start / restart / stop only, `confirm: true` required |
| `POST /api/heidi-mobile/chat` | `POST /api/chat` (SSE) | Streams `delta/tool/meta/actions/error/done` |
| `GET /api/heidi-mobile/events` | `/api/events/stream` (SSE) | Realtime relay, 5-min connection cap |

`GET /api/actions` is new in HYDI: it lists ProtoForge-escalated actions awaiting a
decision. Before it existed, a pending approval could only be seen in the chat reply
that created it.

## Security model

- **No credential in browser JavaScript.** The phone authenticates as a normal
  HYDI *device* (`lib/auth/deviceAuth.js`: per-device HMAC, revocable, RBAC role,
  audit-logged). The device signing key is sealed with AES-256-GCM into an
  `HttpOnly; SameSite=Strict` cookie (`heidi_session`). The sealing key is derived
  (HKDF) from `HYDI_SERVICE_SECRET`, so no new secret is needed. Rotating
  `HYDI_SERVICE_SECRET` logs every phone out.
- **`HYDI_SERVICE_SECRET` never leaves the server** and is never sent upstream by
  Heidi. HYDI sees the phone with its own device role, not as `owner`.
- **"Request access" never exposes a secret.** Heidi registers the device and seals
  the one-time secret into the cookie directly. The device stays `pending` until an
  owner approves it.
- **CSRF:** SameSite=Strict, plus an `x-heidi-request: 1` header required on every
  state-changing call, plus an Origin/Host match. The BFF never answers CORS
  preflights.
- **Input validation:** task IDs must be UUIDs, worker names are identifier-only,
  and the command allowlist is `start|restart|stop`. Messages are capped at 4000 chars
  and bodies at 32 KB. `POST /api/actions/:id` now also rejects non-UUID IDs.
- **Response hygiene:** upstream payloads are shape-validated. Raw tool/executor
  output and the device role are not forwarded. Error text is truncated.
- **Realtime:** the upstream stream only accepts its token in the URL (EventSource
  cannot set headers). The relay sends it as a header, server to server, so no
  credential appears in a phone URL.
- **Revocation:** every BFF call is re-verified by HYDI, except chat (see below),
  which caches a positive approval check for 60 s. Realtime connections are
  recycled every 5 minutes.

### Known, pre-existing issue (not changed here)

`POST /api/chat` (`pages/api/chat.ts`) does **not authenticate**. It runs the
tool-using agent for any caller that can reach port 3000. Heidi Mobile only calls it
after confirming the device is approved, but other callers are not gated. Adding
`requireAuth` there would break `pages/index.tsx` and
`hydi-mobile-protoforge.html`, which call it without credentials. That needs a
maintainer decision.

## Truthful states

| State | Meaning |
|---|---|
| `online` | HYDI answered, accepted this device, returned a well-formed snapshot, and reports healthy |
| `degraded` | Reachable, but subsystems are unhealthy/silent, or a check failed/returned malformed data |
| `offline` | HYDI unreachable (network or timeout) |
| `pending_approval` | Device registered but not yet approved |
| `unauthorized` | HYDI rejects the device (revoked, unknown, clock skew) |
| `forbidden` | Device role lacks `status:view` |
| `unconfigured` | `HYDI_API_URL` invalid |

Cached data is shown with **SAVED COPY** (loaded from the phone) or **STALE**
(older than 90 s) and "Last updated N min ago". A failed chat request shows the
error and a Retry button. It never shows a substitute answer.

## Local-first behaviour

- The service worker (`public/heidi-sw.js`, scope `/heidi`, production builds only)
  caches the app shell and hashed build assets. It never touches `/api/`.
- `localStorage` (`heidi.v1.*`) holds the last 100 chat messages, the last
  status/tasks/activity snapshots with timestamps, preferences, and the unsent
  draft. Credential-shaped keys are stripped before every write, and Unpair wipes
  it all.
- Chat messages are **not** queued for automatic sending later. An instruction
  typed offline could be stale by the time it went out, so the draft is kept for
  you to send deliberately.

## Voice

`lib/heidi-mobile/client/voice.ts` defines the speech-input and speech-output
interfaces. The browser implementation uses the Web Speech API. Recognised text
only fills the composer and is never auto-sent. "Read replies aloud" uses the
phone's own text-to-speech. Both are optional, and text chat works without
microphone permission. A native (Capacitor) implementation can replace the
browser one without touching the chat UI.

## Server setup

Environment on the machine running `heidi-web`:

| Variable | Required | Purpose |
|---|---|---|
| `HYDI_SERVICE_SECRET` | yes | Derives the session-sealing key. Without it Heidi refuses to pair (503) |
| `HYDI_API_URL` | no | HYDI base URL. Default `http://127.0.0.1:$PORT` (the same process) |
| `HEIDI_MOBILE_SESSION_TTL_DAYS` | no | Session lifetime (default 30, max 365) |

HYDI itself needs `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, with the device
tables (`devices`, `auth_audit_log`, `hydi_subsystem_status`, `notifications`,
`agent_control_commands`) migrated. These are the 20260715* migrations.

### Reaching it from the phone

- **Recommended: HTTPS over Tailscale.** Run `tailscale serve --bg 3000` on the
  HYDI PC and open `https://<machine>.<tailnet>.ts.net/heidi`. HTTPS is required
  for the service worker, for "Install app", and for the cookie's `Secure` flag.
- **LAN over plain HTTP** (`http://<pc-ip>:3000/heidi`) works for chat and
  control, but the browser will not install it or cache it offline, and traffic is
  unencrypted.

### Pairing

1. Open `/heidi` on the phone and tap **Request access**. Note the device ID shown
   in the banner. Alternatively, register the device yourself and use
   **Enter credentials**.
2. Approve it from an owner credential:
   ```bash
   # on the HYDI PC — the token is minted locally, never pasted anywhere
   node -e "const c=require('crypto');const t=Date.now()+'';const r=c.randomBytes(8).toString('hex');const s=c.createHmac('sha256',process.env.HYDI_SERVICE_SECRET).update(t+':'+r+':cli').digest('hex');process.stdout.write(t+'.'+r+'.cli.'+s)" \
     | xargs -I{} curl -s -X POST http://127.0.0.1:3000/api/devices \
         -H "x-hydi-service-token: {}" -H "Content-Type: application/json" \
         -d '{"action":"approve","device_id":"heidi-xxxxxxxx","role":"operator"}'
   ```
3. The phone picks up the approval automatically, within 30 s.

Roles: `operator` can chat, view everything, approve/reject, and control workers.
`viewer` is read-only. Approve/Control buttons will show HYDI's 403.

## Files

- `pages/heidi.tsx`, `components/heidi-mobile/*`, `styles/heidi-mobile.module.css`: UI
- `lib/heidi-mobile/client/*`: browser client (api, cache, realtime, voice, format)
- `lib/heidi-mobile/{session,hydiClient,guard,normalize}.js`, `sseParser.ts`: server
- `pages/api/heidi-mobile/*`: BFF routes. `pages/api/actions/index.ts`: approvals list
- `public/heidi.webmanifest`, `public/heidi-sw.js`, `public/heidi-icons/*`: PWA (icons copied from the existing `icons/`)
- Tests: `tests/unit/heidi-mobile-*.test.*`, `tests/unit/actions-list-api.test.js`

## Relationship to the older mobile clients

`hydi-mobile-protoforge.html`, `docs/index.html` (GitHub Pages),
`heidi-mobile-chat.html` / `launch-heidi-mobile.js` (port 3006) and
`termux/hydi-chat-server.js` are unchanged. `docs/index.html` stores
`HYDI_SERVICE_SECRET` in the phone's `localStorage` and signs with it in the
browser. `hydi-mobile-protoforge.html` stores the device signing key in
`localStorage` and passes device tokens in the event-stream URL. `/heidi` avoids
both. Retiring the older clients is a follow-up decision, not part of this change.
