# ProtoForge Walkie — architecture

## 1. What existed in the repository, and what was reused

This was inspected before building anything (2026-10-11, branch based on `clean-main` @ `c93e710`).

| Existing piece | What it is | Reused for Walkie? |
|---|---|---|
| Local Supabase (Docker), incl. **Supabase Auth** | HYDI's data plane; Auth was present but HYDI itself barely uses end-user accounts | **Yes, as the identity provider.** Walkie verifies Supabase access tokens (HS256 secret or project JWKS). Sign-in is email one-time code. |
| Supabase **Postgres** | HYDI's database | **Yes, as storage**, in a separate `walkie` schema with RLS on and no policies, so it touches none of HYDI's tables or migrations. |
| `lib/auth/deviceAuth.js`, `requireAuth.js`, `rbac.js` | Per-*device* HMAC auth for operator phones, owner-approved, RBAC roles | **No.** It authenticates trusted operator devices for HYDI control, not ordinary end users joining channels. Mixing them would give walkie users a path into HYDI's control surface. |
| Heidi Mobile (`/heidi` PWA, `pages/api/heidi-mobile/*`) | Phone chat/control UI for HYDI | **No.** It is a browser PWA; live push-to-talk audio needs native WebRTC and native audio sessions. |
| `capacitor.config.json` (`com.protoforge.hydi`) | A web-wrapper config for the HYDI PWA; no native projects are checked in | **No.** Capacitor wraps a WebView; the brief asked for React Native, and LiveKit's native SDKs are the supported path for audio routing and later background work. |
| `lib/voice/intentParser.js` | Speech-to-text command intents for HYDI | **No**, deliberately. Walkie does no speech recognition or AI processing of conversations. |
| SSE/WebSocket servers (`modules/heidi-websocket-server.js`, `api/events/stream.js`) | HYDI event streaming | **No.** Speaker state reaches clients through LiveKit room metadata, which travels on the same connection as the audio. |
| CI (`unit-tests.yml`, `integration-tests.yml`), `.githooks/pre-push` | Root Jest/tsc gates | Untouched. Walkie lives under `apps/`, which root `tsc`, ESLint and Jest already exclude. It has its own path-filtered workflow, `.github/workflows/walkie.yml`. |

**Missing (and not assumed):** LiveKit of any kind, a React Native project,
Android/iOS signing keys, an Apple Developer team with the Push to Talk
entitlement, APNs keys, a LiveKit Cloud project, a production host for the
backend, and Supabase email-OTP template configuration.

## 2. Project layout (standalone, inside this repo)

```
apps/walkie/
  server/     TypeScript backend (Fastify). Owns auth, channels, invites,
              membership, blocks, LiveKit tokens, speaker arbitration.
  mobile/     Expo SDK 57 / React Native 0.86 app (development builds).
  livekit/    Local LiveKit server config (dev keys, webhook → backend).
  docs/       This file, security, background milestones, device tests,
              costs, status, measured results.
  docker-compose.yml   LiveKit + Postgres for local development.
```

## 3. Runtime picture

```
 Phone A (RN app)                     Walkie backend                 LiveKit SFU
 ───────────────                      ──────────────                 ───────────
 sign in (Supabase OTP) ───────────▶ verify JWT (sub = user id)
 POST /channels/:id/connection ────▶ member? → subscribe-only token ─▶ (token: canPublish=false)
 room.connect(token) ─────────────────────────────────────────────────▶ join, listen only
 press  → POST /talk ──────────────▶ acquire lease (atomic, 1/channel)
                                     updateParticipant(canPublish=true,
                                       sources=[MICROPHONE]) ───────────▶ permission granted
                                     roomMetadata.speaker = A ─────────▶ broadcast to room
        ◀── 200 {leaseId, renewEveryMs, maxMs}
 mic on (setMicrophoneEnabled) ───────────────────────────────────────▶ publish Opus audio ─▶ Phone B
 every renewEveryMs → POST /renew ─▶ extend renew deadline (≤ hard deadline)
 release → mic off (local, first) → DELETE /talk/:lease
                                     delete lease, canPublish=false ───▶ LiveKit unpublishes
                                                                         A's tracks itself
```

### Speaking-turn lease (server-authoritative)

* **One row per channel** (`walkie.floor_leases`, primary key `channel_id`). A
  single `INSERT … ON CONFLICT DO UPDATE … WHERE <current lease dead or mine>`
  statement grants it. Postgres row locking serialises concurrent callers,
  including callers in different backend processes. Tested with 25 concurrent
  requesters: exactly one wins.
* **Two deadlines.** `renew_deadline` (now + `TALK_RENEW_TTL_MS`, default 5 s)
  must be pushed forward by the holder. `hard_deadline` (grant + `TALK_MAX_MS`,
  default 30 s) is never extended, including when the same user re-requests.
* **Enforcement is in the media server.** Join tokens never grant publish.
  Publishing is granted per turn with `updateParticipant`, limited to the
  `MICROPHONE` source, and revoked when the turn ends. When the permission is
  revoked, LiveKit itself unpublishes the participant's tracks. This was
  verified against a real LiveKit 1.13.9 with a client that ignored the release
  and kept sending audio.
* **Every way a turn ends revokes publishing:** explicit release, missed renewal
  (lost connectivity), max duration, the LiveKit `participant_left` webhook,
  leaving, removal, block, channel deletion, and account deletion.
* **Ordering.** Within a process, operations on one channel run through a
  per-channel promise chain, so a grant and a revoke for the same participant
  cannot reorder. After granting, the server re-reads the lease. If another
  instance reclaimed it meanwhile, the grant is taken back.
* **Reconciliation** (every `RECONCILE_INTERVAL_MS`, default 10 s) repairs drift
  between the database and LiveKit. It removes participants who are not members,
  revokes publishing from anyone who does not hold the lease, and reclaims a
  lease whose holder is no longer in the room. Webhooks
  (`participant_joined`, `track_published`) apply the same rules immediately.
* **Rate limiting:** a minimum gap between talk requests
  (`TALK_MIN_REQUEST_INTERVAL_MS`) plus a burst cap (`TALK_BURST` per
  `TALK_BURST_WINDOW_MS`), per user and channel. Answers are `429` with
  `Retry-After`.

### Client state machine

`mobile/src/ptt/machine.ts` is a pure reducer: `(state, event) → (state, effects)`.
Its rules:
* The mic starts only on `GRANTED` while the button is still held.
* Release emits `stopMic` before `releaseTurn`.
* A grant that arrives after release is handed straight back.
* Losing the turn, the connection, or mic permission stops the mic.
* Room metadata only updates the display. It never starts or ends a turn,
  because it can arrive late relative to the HTTP grant.

Mic operations run strictly in order. A fuzz test checks the invariant "mic on
⇒ holding the button with a granted turn, connected, with permission" over
18,000 random event steps.

### API (all `/v1/*` need `Authorization: Bearer <Supabase access token>`)

| Method & path | Who | Purpose |
|---|---|---|
| `GET/PUT/DELETE /v1/me` | self | profile; display name; **account deletion** |
| `GET/POST /v1/channels` | any signed-in user with a display name | list / create private channel |
| `GET/DELETE /v1/channels/:id` | member / owner | detail (members, speaker) / delete |
| `POST /v1/channels/:id/invites` | owner | single-use code, 24 h, only SHA-256 stored |
| `POST /v1/invites/redeem` | signed-in | join with a code |
| `POST /v1/channels/:id/leave` | member | leave |
| `DELETE /v1/channels/:id/members/:userId` | owner | remove (kick + token revocation) |
| `GET/POST /v1/channels/:id/blocks`, `DELETE …/blocks/:userId` | owner | block / unblock |
| `POST /v1/channels/:id/connection` | member | short-lived, subscribe-only LiveKit token |
| `GET/POST /v1/channels/:id/talk` | member | current speaker / request turn (`200`, `409 busy`, `429`) |
| `POST /v1/channels/:id/talk/:lease/renew` | holder | keep turn (`410` when gone) |
| `DELETE /v1/channels/:id/talk/:lease` | holder | release (idempotent) |
| `POST /livekit/webhook` | LiveKit (signed) | joins/leaves/track events |

A non-member gets the same `404` whether or not the channel exists.

## 4. Scaling notes

* State is in Postgres, so several backend instances can run behind a load
  balancer. The talk rate limiter is per process; with N instances a user's
  budget is up to N× the limit. Move it to Postgres or Redis if that matters.
* One LiveKit room per channel. `MAX_CHANNEL_MEMBERS` (default 50) also sets
  `maxParticipants` on the room.
