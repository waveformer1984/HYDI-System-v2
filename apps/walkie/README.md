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
* Android background operation (Milestone 2) is implemented but **unverified on
  devices**.
* iOS lock-screen operation through Apple's PushToTalk framework
  (Milestone 3): the server side is implemented and tested; the iOS code has
  **never been compiled or run**.

| Doc | |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | What is implemented, tested, blocked, planned |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Repo inventory (what was reused), design, API |
| [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md) | Auth, tokens, encryption (not E2EE), privacy, account deletion |
| [docs/DEVICE_TEST_CHECKLIST.md](docs/DEVICE_TEST_CHECKLIST.md) | Physical two-phone acceptance tests + latency method |
| [docs/BACKGROUND_MILESTONES.md](docs/BACKGROUND_MILESTONES.md) | Milestone 2 Android foreground service / Milestone 3 iOS PushToTalk |
| [docs/COSTS.md](docs/COSTS.md) | Operating-cost estimates with assumptions |
| [docs/QR_JOIN.md](docs/QR_JOIN.md) | **Join by QR code**: browser walkie for guests, owner sign-in QR, public hosting via Tailscale Funnel + LiveKit Cloud |

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

**Background (Milestone 2):**
* The local module `modules/walkie-background` is autolinked into Android builds.
* Its service can be compile-checked without an SDK:
  `gradle -p native-checks/android-service compileKotlin`.
* Run the B1–B17 checks in the device checklist.
* Publishing on Google Play needs a foreground-service declaration for the
  `microphone` and `mediaPlayback` types.

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

**Lock-screen talk (Milestone 3):**
1. Enable the **Push to Talk** capability for the app ID in your Apple
   Developer account (Xcode → Signing & Capabilities → + Capability → Push to
   Talk, plus Background Modes → Push to Talk and Push Notifications). Apple's
   guide shows it as a normal capability; if your account does not offer it,
   request it through Apple Developer support. Not yet tried with a real
   account.
2. Create an **APNs auth key** (`.p8`). Configure the backend with
   `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_BUNDLE_ID`
   (see `server/.env.example`).
3. Build:
   `WALKIE_IOS_PTT=1 APP_VARIANT=development npx expo run:ios --device`.
   * The flag adds the entitlement, `aps-environment` and the `push-to-talk`
     background mode.
   * Without it, the app builds and signs as before (foreground only).
   * Development builds register tokens as APNs **sandbox**. Set
     `WALKIE_APNS_ENV=production` for TestFlight and App Store builds.
4. Run checklist P1–P14 in the device test checklist. The Swift in
   `modules/walkie-ptt` has never been compiled, so expect small fixes on the
   first build.

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
          src/ptt/useChannelSession.ts (LiveKit + lease), src/screens/*,
          src/ptt/useBackgroundService.ts + modules/walkie-background (Android FGS),
          native-checks/android-service (SDK-free compile check),
          src/ptt/useIosPtt.ts + modules/walkie-ptt (iOS PushToTalk)
livekit/  livekit.dev.yaml (dev-only keys, webhook → backend)
docs/     design, security, tests, costs, status, measured results
```
