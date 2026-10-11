# ProtoForge Walkie

Private-channel, hold-to-talk voice for Android and iPhone over Wi-Fi or
cellular data:
* React Native (Expo development builds)
* LiveKit for real-time audio
* A TypeScript backend that owns authentication, channel membership,
  short-lived room tokens and a server-authoritative speaking turn

**Scope:**
* Foreground MVP.
* No offline, radio-frequency or emergency-service use.
* No recording, transcription or AI processing.
* Background and locked-screen operation are separate, **unverified** milestones.

| Doc | |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | What is implemented, tested, blocked, planned |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Repo inventory (what was reused), design, API |
| [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md) | Auth, tokens, encryption (not E2EE), privacy, account deletion |
| [docs/DEVICE_TEST_CHECKLIST.md](docs/DEVICE_TEST_CHECKLIST.md) | Physical two-phone acceptance tests + latency method |
| [docs/BACKGROUND_MILESTONES.md](docs/BACKGROUND_MILESTONES.md) | Android FGS / iOS PushToTalk investigation |
| [docs/COSTS.md](docs/COSTS.md) | Operating-cost estimates with assumptions |

## 1. Run the backend locally

Requirements: Node ≥ 20, Docker.

```bash
cd apps/walkie
docker compose up -d              # LiveKit 1.13.9 (host network) + Postgres on :55432
cd server
npm ci
cp .env.example .env              # then edit (see below); .env is gitignored
npm run dev                       # http://0.0.0.0:8787, applies migrations if DATABASE_URL is set
curl http://127.0.0.1:8787/healthz
```

**For phones on your Wi-Fi:**
* In `livekit/livekit.dev.yaml`, set `rtc.node_ip` to your computer's LAN IP, and
  allow TCP 7880–7881 and UDP 50000–50200 through its firewall.
* In `server/.env`:
  * set `LIVEKIT_URL=ws://<LAN-IP>:7880`
  * set `LIVEKIT_API_URL=http://127.0.0.1:7880`
  * to use Postgres instead of memory, set
    `DATABASE_URL=postgres://postgres:walkie@127.0.0.1:55432/walkie`, or point it
    at the local HYDI Supabase DB. Walkie uses its own `walkie` schema.
* **Auth:** `AUTH_MODE=dev` (any handle signs in, development only) or
  `AUTH_MODE=supabase` with `SUPABASE_URL` (plus `SUPABASE_JWT_SECRET` for HS256
  projects).
  * For Supabase email codes, the "Magic Link" email template must include
    `{{ .Token }}`.

### Backend tests

```bash
cd apps/walkie/server
npm run typecheck
npm test                                     # memory store; add WALKIE_TEST_DATABASE_URL=… for Postgres too
WALKIE_TEST_DATABASE_URL=postgres://postgres:walkie@127.0.0.1:55432/postgres npm test
npm run test:livekit                         # real LiveKit + WebRTC clients (needs docker compose up; port 8787 free)
```

CI: `.github/workflows/walkie.yml` runs all of the above on PRs touching
`apps/walkie/**`.

## 2. Mobile app

```bash
cd apps/walkie/mobile
npm ci
cp .env.example .env     # EXPO_PUBLIC_WALKIE_API_URL=http://<LAN-IP>:8787, AUTH_MODE matching the backend
npm run typecheck && npm test
```

The app uses native WebRTC, so **Expo Go cannot run it**. You need a
development build.

### Android development build

Requirements:
* Android Studio (SDK Platform + Build-Tools for the API level Expo 57 targets)
* JDK 17+
* `ANDROID_HOME` set
* A phone with USB debugging enabled

```bash
cd apps/walkie/mobile
APP_VARIANT=development npx expo run:android --variant debug   # builds, installs and launches
# APK: android/app/build/outputs/apk/debug/app-debug.apk  (install on phone #2: adb install -r …)
npx expo start --dev-client                                    # serves JS to the dev build
```

`APP_VARIANT=development` allows plain `http://` and `ws://` to your LAN backend.
Builds without it require `https`/`wss`.

**Signing:**
* Debug builds use Android's auto-generated debug keystore.
* A release keystore (`*.jks`, gitignored) is needed only for distribution. Keep
  it out of the repo.

**Not done here.** This APK was **not built** in the delivery environment: no
Android SDK, and `dl.google.com` is blocked. See STATUS.md.

### iOS build instructions and signing requirements

Requirements:
* A Mac with Xcode (current for Expo SDK 57) and CocoaPods
* An **Apple Developer Program membership ($99/yr)**. A free Personal Team can
  install on your own device for 7 days, but cannot get the Push to Talk
  entitlement later.
* A unique bundle identifier:
  * `com.protoforge.walkie.dev` for development builds
  * `com.protoforge.walkie` for release builds
  * Change these if the IDs are taken.

```bash
cd apps/walkie/mobile
APP_VARIANT=development npx expo run:ios --device   # pick the connected iPhone; Xcode handles provisioning
```

**In Xcode** (`ios/*.xcworkspace` → Signing & Capabilities):
* Select your Team and enable automatic signing.
* Trust the developer certificate on the phone: Settings → General → VPN &
  Device Management.

**App Transport Security:** development-variant builds set
`NSAllowsLocalNetworking` so they can reach `http://`/`ws://` LAN addresses.
Release builds require TLS.

**Milestone 3 (background) will additionally need:**
* The Push to Talk entitlement, requested from Apple
* The `push-to-talk` background mode
* An APNs auth key on the server

**Cloud alternative.** EAS Build can build both platforms without local
toolchains (`npx eas-cli build --profile development`). It needs an Expo account
and, for iOS, Apple credentials. **It requires owner approval** before use.

## 3. Two-phone smoke test

1. On both phones: sign in → display name.
2. Phone A: create a channel → **Invite someone** → share the code.
3. Phone B: **Join with code**.
4. Both phones open the channel. Status reads **Listening** and there is no
   microphone indicator.
5. Hold the big button on A and talk. B hears it. Release, and B goes silent.

Then run the full [device checklist](docs/DEVICE_TEST_CHECKLIST.md).

## Layout

```
server/   Fastify + zod + jose + livekit-server-sdk + pg; migrations/ ; test/
mobile/   Expo SDK 57 app: App.tsx, src/ptt/machine.ts (pure PTT logic),
          src/ptt/useChannelSession.ts (LiveKit + lease), src/screens/*
livekit/  livekit.dev.yaml (dev-only keys, webhook → backend)
docs/     design, security, tests, costs, status, measured results
```
