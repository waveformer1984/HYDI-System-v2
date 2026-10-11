# Security and privacy

## Authentication and authorization

| Control | Implementation | Verified by |
|---|---|---|
| Every API call is authenticated | Bearer Supabase access token. The backend checks signature, issuer (`<SUPABASE_URL>/auth/v1`), audience `authenticated` and role `authenticated`. Anonymous Supabase users are refused. | `api.test.ts` (wrong issuer/audience/key/anonymous/service role, forged tokens, missing header) |
| Membership checked server-side on every channel call | `requireMember` before detail, connection token, talk, renew. Owner-only actions use `requireOwner`. | `api.test.ts` "unauthorized user cannot see, join or talk" |
| Least-privilege, short-lived room tokens | Room-scoped, `canPublish=false`, no data channel, no self-metadata, TTL `JOIN_TOKEN_TTL_S` (default 300 s) | `api.test.ts` JWT claim check; real LiveKit refuses publish without a grant (`livekit.integration.test.ts`) |
| Publish rights only during a granted turn | See ARCHITECTURE.md §3 | Real LiveKit: unauthorized publish refused, wrong source refused, revoke cuts off a client that keeps sending |
| Forged room tokens | LiveKit verifies the signature with the API secret, which only the backend holds | `livekit.integration.test.ts` |
| Removed or blocked users | Membership deleted, then `removeParticipant` (with `revokeTokenTs`), lease released. A later join is evicted by the `participant_joined` webhook and by reconcile. | Real LiveKit test (see the limitation below) |
| Invite codes | 20 characters from a 30-symbol alphabet (~98 bits). Single use by default, expire after 24 h. Only the SHA-256 is stored. A blocked user cannot redeem. | `store.contract.test.ts`, `api.test.ts` |
| Webhooks | Signature verified (`WebhookReceiver`) over the raw body; otherwise `401` | `api.test.ts` |
| Brute force / spam | Talk rate limit; 16 KB body limit | `floor.test.ts`, `api.test.ts` |

### Secrets

* The **mobile app holds no server secret.** Build-time values are the API URL,
  the auth mode, and the Supabase URL and **anon** key, which Supabase designs to
  be public. `mobile/.env.example` says so explicitly.
* The LiveKit API secret, Supabase JWT secret, service-role key and database URL
  exist only in the backend's environment (`server/.env`, gitignored).
* Production guards in `config.ts`:
  * `AUTH_MODE=dev` is refused.
  * The in-memory store is refused.
  * `ws://` LiveKit URLs are refused.
  * `LIVEKIT_API_SECRET` must be at least 32 characters.
* The dev LiveKit key in `livekit/livekit.dev.yaml` is a public placeholder for
  local testing only.

### Logging

* Fastify request logs contain method, URL (channel and lease UUIDs) and status.
  The `Authorization` and `Cookie` headers are removed.
* Request bodies are not logged.
* Audio never passes through the backend. It flows phone ↔ LiveKit ↔ phone, so
  the backend cannot log voice.
* LiveKit server logs contain connection metadata (identities, room names, IPs).
  They contain no media.

## iOS PushToTalk (Milestone 3)

* **Tokens:** PTT push tokens are stored server-side only (RLS on, no
  policies). They are registered only by a member of that channel. They are
  deleted on removal, block, channel deletion and account deletion, and when
  APNs reports them dead.
* **Push payloads** pass through Apple's push service and contain the speaker's
  **display name, user id, channel id and lease id**. **No audio** and no
  channel name. A leave push contains only `{leave: true, channelId}`.
* **APNs key:** the `.p8` key is a server secret (env `APNS_KEY_P8` /
  `APNS_KEY_FILE`). It never ships in the app.
* **Microphone:** with lock-screen talk on, iOS's system UI can start a turn.
  It is still server-arbitrated and capped at the maximum talk time. The mic
  opens only after iOS activates the audio session.

## Transport encryption: what is and is not true

* **Signalling** (phone ↔ LiveKit) uses WebSocket. In production it **must** be
  `wss://` (TLS). In development builds it is plain `ws://` on the LAN, and only
  `APP_VARIANT=development` builds allow cleartext.
* **API calls** (phone ↔ backend): HTTPS in production, plain HTTP on the LAN in
  development.
* **Media** is WebRTC SRTP, keyed by DTLS (DTLS-SRTP), and is always encrypted on
  the wire.
* **This is NOT end-to-end encryption.** LiveKit is an SFU: it terminates
  DTLS-SRTP per hop, so the LiveKit server (or LiveKit Cloud, if used) can access
  decrypted audio packets while relaying. LiveKit supports E2EE through insertable
  streams with a shared key (`RNE2EEManager` is exported by the RN SDK), but
  **Walkie does not implement it**. Do not claim E2EE. Adding it needs key
  distribution and rotation on membership changes, and it was not tested.

## Privacy

* **No recording, transcription or AI processing.** No LiveKit Egress or agents
  are configured. The backend has no endpoint that touches audio.
* **Microphone:**
  * Off on join.
  * **Android background (Milestone 2):** the notification's Talk button starts a
    *latched* turn. It still needs the server's grant, is offered only when mic
    permission is already granted, and ends on Stop talking, at the maximum talk
    time, or on any loss of the turn. The foreground service itself never opens
    the mic. On a secure lock screen the notification's contents and actions are
    hidden until unlock (`VISIBILITY_PRIVATE`).
  * On only while the button is held and the server has granted the turn.
  * Released by unpublishing and stopping the capture track, so the OS mic
    indicator turns off.
  * The permission text (iOS `NSMicrophoneUsageDescription`) and the Settings
    screen explain this.
  * If permission is denied, the app explains it and offers "Open settings".
    Listening still works.
* **Camera, overlay and storage** permissions that the WebRTC plugin or template
  would add are removed from the Android manifest (`blockedPermissions`). This was
  verified in the generated manifest.
* **Data stored:**
  * Display name.
  * Channel name, membership, blocks.
  * Invite hashes.
  * The live lease, deleted when the turn ends.
* **Account deletion** (`DELETE /v1/me`, Settings → Delete account):
  * Deletes the profile, memberships, blocks naming the user, and live leases.
  * Deletes the channels the user owns, for everyone in them, and disconnects
    those rooms.
  * Disconnects the user from the other channels.
  * Deletes the Supabase Auth user when `SUPABASE_SERVICE_ROLE_KEY` is
    configured. The response reports `authUserDeleted` truthfully.

## Known limitations (security-relevant)

1. **Rejoin window after removal.** Against LiveKit 1.13.9, a removed member who
   reconnected with a room token obtained *before* removal was admitted. That
   means `revokeTokenTs` did **not** block it in our test. The
   `participant_joined` webhook evicted them **~120 ms** later, so they could
   receive up to ~0.1 s of audio. If the webhook is lost, reconcile closes the gap
   within `RECONCILE_INTERVAL_MS`. Lowering `JOIN_TOKEN_TTL_S` narrows the window
   in which a stale token exists at all.
2. Talk rate limiting is per backend process.
3. Not done yet: no penetration test, no dependency audit beyond `npm audit`, no
   production TLS deployment.
