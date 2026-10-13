# Join by QR code

A person can join your walkie channel by scanning a QR code with their phone camera.
There is nothing to install and no account to make. They type a name, tap **Join and
talk**, and hold the big button to talk.

## How it works

| Step | Who | What happens |
|---|---|---|
| 1. Sign in | you | On heidi-pc run `npm run owner-login -- "Frank"`. Scan the QR it prints. Your phone opens `…/w#login=…` and is signed in as the channel owner. This needs no email. The QR works once and expires after 10 minutes. |
| 2. Create a channel | you | In the page (or the app), create a channel, then tap **Invite QR**. |
| 3. Scan | them | They point their camera at the QR. Their browser opens `…/j/<code>` and shows "Frank invited you to Garage". |
| 4. Join | them | They type a name and tap **Join and talk**. They become a **guest** of that channel. The browser asks for the microphone once. |
| 5. Talk | both | Hold to talk, release to listen. The server gives the floor to one person at a time, exactly as in the app. |

**If they have the Walkie app**, the join page also offers **Open in the Walkie app**
(`protoforgewalkie://join/<code>`). The app then joins them the same way. The app can
also show an invite QR itself: open the channel, then **Invite with QR code**.

**Returning guests** stay signed in on that phone for `GUEST_SESSION_DAYS` (30 by
default). Reopening `…/w` takes them straight back to their channels. Signing out, or
clearing the browser's data, means they need a new invite.

## What a guest can and cannot do

**A guest can:**
* listen and talk in the channels they were invited to;
* change their display name;
* leave a channel or delete their guest account.

**A guest cannot:**
* create channels;
* create invites;
* see any channel they were not invited to.

**As the owner you control guests** like any other member: long-press a member to
**Remove** or **Block** them, or delete the channel. A removed guest's session stays
valid, but it no longer opens anything.

**Invites:**
* single-use by default;
* expire after `INVITE_TTL_HOURS` (24);
* stored only as a SHA-256 hash.

A used or expired QR shows "already used or expired". It does not show the channel.

> **Blocking guests has a limit.** A guest is identified by the session in their
> browser. Blocking one stops that session, but someone who clears their browser and
> gets a **new** invite from you comes back as a new guest. Only ever show invite QRs
> to people you mean to let in.

## One-time setup on heidi-pc (public via Tailscale Funnel + LiveKit Cloud)

The two phones are on different networks, so both the walkie backend and the voice
server must be reachable from the internet:
* **Voice** goes through **LiveKit Cloud** (free "Build" plan).
* **The walkie backend** stays on heidi-pc and is published with **Tailscale Funnel**
  on port **8443 only**.

heidi-web (443) and the MCP server (8470) stay tailnet-only.

### 1. LiveKit Cloud (free plan, needs an account)

1. Sign up at <https://cloud.livekit.io> and create a project. The free Build plan
   includes about 5,000 participant-minutes a month: about 41 hours of two phones
   connected (5,000 ÷ 2). Verify the current allowance on livekit.com/pricing; see
   `COSTS.md`.
2. **Settings → API keys** → create a key. Keep the URL (`wss://<project>.livekit.cloud`),
   the key and the secret for step 2.
3. **Settings → Webhooks** → add `https://heidi-pc.tailc50af2.ts.net:8443/livekit/webhook`
   and sign it with the API key from step 2. (Step 4 prints the exact URL.)

LiveKit Cloud includes TURN, so voice also works on cellular and strict Wi-Fi.

### 2. `apps\walkie\server\.env`

Never commit this file. Use `.env.example` as the template.
* Type the LiveKit secret into the file directly; don't paste it into a chat or a
  terminal.
* Step 4 generates `WALKIE_SESSION_SECRET` into the file for you.

```ini
NODE_ENV=production
PORT=8787
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres   # local HYDI Supabase (own `walkie` schema)
AUTH_MODE=supabase
SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_BASE_URL=https://heidi-pc.tailc50af2.ts.net:8443
```

`AUTH_MODE=dev` is refused in production. Owner sign-in and guests use
`WALKIE_SESSION_SECRET`. Supabase email sign-in keeps working for anyone who has
an account.

### 3. Run the walkie backend under PM2

This is a separate PM2 app, not part of `ecosystem.config.js`:

```powershell
cd apps\walkie\server
npm ci
npm run build:web
pm2 start src/index.ts --name walkie-server --interpreter node --node-args="--import tsx"
pm2 save
curl.exe -s http://127.0.0.1:8787/healthz    # {"ok":true}
```

* The server reads its secrets from `.env` at startup, so they never enter PM2's
  saved environment (`dump.pm2`).
* After pulling new code, run `npm ci; npm run build:web; pm2 restart walkie-server`.

### 4. Publish it (Funnel on :8443 only)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tailscale\funnel-walkie.ps1
```

**What the script does:**
* generates `WALKIE_SESSION_SECRET` if it's missing (restart `walkie-server` after
  that);
* checks the server is healthy;
* runs `tailscale funnel --bg --https=8443 http://127.0.0.1:8787`;
* **refuses to continue if Funnel is on for any other port**;
* prints the public URL.

**Turning it off:** run the same script with `-Remove`.

**If Funnel is refused:** the tailnet policy needs the `funnel` node attribute for
heidi-pc (admin console → Access controls → `nodeAttrs`).

### 5. Check from a phone on mobile data (Wi-Fi off)

1. `https://heidi-pc.tailc50af2.ts.net:8443/healthz` → `{"ok":true}`.
2. `npm run owner-login -- "Frank"` on heidi-pc → scan it → "Signed in as Frank".
3. Create a channel → **Invite QR** → scan it with a second phone → **Join and talk** →
   hold to talk on each phone in turn.

## What is public

Funnel exposes only the walkie backend (`127.0.0.1:8787`).

| Route | Auth |
|---|---|
| `GET /healthz` | none (returns `{"ok":true}`) |
| `GET /j/<code>`, `GET /w`, `GET /web/app.js` | none: the static web client. Strict CSP, `Referrer-Policy: no-referrer` (the code is in the URL), microphone allowed for this origin only |
| `GET /v1/invites/<code>/preview` | invite code; per-IP limit (`PUBLIC_RATE_PER_MIN`, 20/min) |
| `POST /v1/join` | invite code; per-IP limit |
| `POST /v1/session/exchange` | one-time owner ticket (10 min, single use); per-IP limit. No route mints tickets: only `owner-login` on heidi-pc, which needs `WALKIE_SESSION_SECRET` |
| `POST /livekit/webhook` | LiveKit signature (not rate-limited) |
| every other `/v1/…` | bearer token (Supabase, owner or guest session) |

Every route except the webhook also shares a per-IP ceiling (`API_RATE_PER_MIN`, 600/min),
enforced by `@fastify/rate-limit`. Responses carry `x-ratelimit-*` headers, and a 429
says `{"error":"rate_limited","retryAfterMs":…}`. Talk requests keep their own, finer
limiter on top.

There are no recordings or transcripts. Audio goes phone → LiveKit Cloud → phone.

## Limits of the browser version

* **Keep the page open, with the screen on.** The page asks the phone to keep the
  screen awake while in a channel. A locked screen or a backgrounded tab stops
  audio, and any press in progress is released.
  * For locked-screen use there is the native app's Android background service and
    iOS PushToTalk (`BACKGROUND_MILESTONES.md`). Those need an installed build.
* **The first tap unlocks sound.** Browsers block audio until you tap. After a reload
  the page shows **Tap to turn on sound**, and pressing Talk also unlocks it.
* **The first press asks for the microphone** if the join tap didn't already.

## Verification record

**2026-10-13, cloud container:** local LiveKit 1.13.9, Postgres 16, two headless
Chromium browsers with fake microphones, phone-sized viewports. The script is
`server/e2e/qr-join.e2e.mjs` (see its header for how to run it), against `npm start`. 17/17 checks passed:
1. Owner signed in from the `owner-login` link, and the ticket was stripped from the
   address bar.
2. The owner created a channel. The invite QR image, decoded with jsQR, gave exactly
   `<base>/j/<code>`.
3. The second browser opened it, saw "Frank invited you to …", joined as "Sam" and
   reached "Listening".
4. The owner held Talk. Sam's page showed "Frank is talking", and WebRTC stats showed
   **5,862 bytes of Opus audio received**. Release freed the floor.
5. Sam held Talk. The owner saw "Sam is talking" and received **4,819 bytes of audio**.
6. A third browser scanning the same QR was refused. Sam's page reload stayed signed
   in.

Server unit/API tests: 84 on the memory store; 97 including Postgres. Real-LiveKit
integration: 10/10.

**Not verified here:**
* real phones or real speakers and mics;
* Safari or iOS;
* LiveKit Cloud;
* Tailscale Funnel (no Windows or Tailscale in the container);
* `funnel-walkie.ps1` itself;
* the native app's QR screen and deep links. Those are typechecked and unit-tested
  only; they need a new app build, because `react-native-svg` is native.
