# Status report — 2026-10-11 (updated for Milestones 2 and 3)

> **Post-merge validation (2026-10-12):** see `docs/results/POSTMERGE_VALIDATION_2026-10-12.md`. All automated suites pass on `clean-main`. B1–B17 and P1–P14 are BLOCKED here: no Android SDK, macOS, Tailscale or device. The CI blocker has been isolated to billable Actions usage.

Status words are used strictly:
* **Implemented**: code exists.
* **Tested**: automated tests ran here and passed, with the evidence named.
* **Blocked**: cannot proceed without something outside this environment.
* **Planned**: not started.

**Milestone 1 is NOT complete.** Its acceptance criterion is two *physical*
phones, and none were available.


## Milestone 2 — Android background (started 2026-10-11)

| Status | Item |
|---|---|
| **Implemented** | Foreground service (`microphone\|mediaPlayback`, listen-only fallback without mic permission), persistent notification with Talk / Stop talking / Disconnect, latched notification turns capped by the server's maximum talk time, "Stay connected in background" switch, notification-permission request, Settings explanation. See `BACKGROUND_MILESTONES.md`. |
| **Tested here** | Service compiles against the Android 16 framework classes, warnings as errors (`native-checks/android-service`); the negative control fails as expected. Expo autolinking resolves the module. Notification content and background-release policy are unit-tested: mobile tests 23/23. Typecheck and Android/iOS bundles pass. |
| **Blocked** | Building an APK and running it. No Android SDK here; `dl.google.com` and `maven.google.com` are blocked. The Expo bridge `WalkieBackgroundModule.kt` has not been compiled. |
| **Unverified** | Everything on a device: the B1–B17 checklist in `DEVICE_TEST_CHECKLIST.md`, including screen-off receive, battery, OEM battery managers, and lock screen. |

## Milestone 3 — iOS PushToTalk (started 2026-10-11)

| Status | Item |
|---|---|
| **Implemented and tested (server)** | Per-channel PTT push tokens (migration 002), an APNs `pushtotalk` sender (ES256 provider token, HTTP/2), a push to the other members' iPhones on every new turn, leave pushes on remove/block/channel or account deletion, and cleanup of dead tokens. Server tests: 79/79 on memory and Postgres, including 15 new; real LiveKit 10/10. |
| **Implemented, never compiled (iOS)** | `modules/walkie-ptt` (Swift: `PTChannelManager` owner, delegates, restoration), audio-session hand-off to PushToTalk, a mic gate on `didActivate`, "Turn on lock-screen talk", latched system-UI Talk, cold-start reopen. Policy logic is unit-tested (mobile 29/29). iOS prebuild produces the entitlement and background mode only with `WALKIE_IOS_PTT=1`. |
| **Fixed along the way** | A latched turn (Android notification or iOS system UI) did not release when the server ended it, so the next Talk was ignored. Now released and tested. |
| **Blocked** | Compiling and running on iPhone: needs macOS + Xcode, an Apple Developer team, Apple's Push to Talk entitlement and an APNs key. |
| **Unverified / main risk** | WebRTC audio inside a PushToTalk-activated session; wake-up latency (first words likely lost while reconnecting). Checklist P1–P14. |

## Implemented and tested (automated, in this environment)

| Area | Evidence |
|---|---|
| Backend: auth, profiles, channels, single-use invites, leave/remove/block/unblock, account deletion, subscribe-only room tokens | `server/test/api.test.ts`: 20 tests pass |
| Atomic speaking-turn lease (one speaker per channel), renew TTL, max duration, release, expiry | `server/test/store.contract.test.ts`: 22 tests pass on the **in-memory store and real Postgres 16** (25 concurrent requesters → exactly 1 winner; concurrent single-use invite → 1 member) |
| Floor service: grant/revoke ordering, release-during-grant race, sweep, reconcile, webhooks, rate limiting | `server/test/floor.test.ts`: 20 tests pass. A mutation check (removing the revoke on release) makes 3 tests fail |
| **Enforcement in a real media server** | `server/test/livekit.integration.test.ts`: 10/10 pass against **LiveKit 1.13.9** with real WebRTC audio, on both stores. Covered: non-member refused; forged LiveKit token refused; publish without the turn refused and nothing heard; granted speaker heard by the other client; release cuts off a client that keeps sending (≈8–27 ms to unpublish); non-microphone source refused; 10/10 simultaneous-press rounds produce one speaker; stopped renewals cut off the speaker at ≈1.7 s (TTL 2 s); max duration enforced at 6.04–6.07 s (configured 6 s); abrupt disconnect frees the floor in ≈60 ms; removed member evicted |
| Client push-to-talk state machine | `mobile/test/machine.test.ts`: 16 tests pass, incl. a fuzz invariant over 18,000 random steps (mic never on without a held, granted, connected, permitted turn) |
| Mobile app compiles and bundles | `tsc` clean. `expo export` produced Android and iOS Hermes bundles (880/882 modules). `expo prebuild` produced the expected Android manifest (mic + Bluetooth; camera, overlay and storage removed; cleartext only in the dev variant) |
| Repo gates unaffected | Root `npm run typecheck` passes. Root Jest discovers no walkie files |

**Measured latency (loopback, not phones).** Raw data is in
`docs/results/livekit-loopback-2026-10-11-*.json`:
* press→grant: 15–65 ms
* grant→track published: ≈2 ms
* press→first audible frame at the listener: **407–450 ms**
* release→listener's track gone: 8–27 ms

## Implemented, not yet tested on a device

* The mobile UI: sign-in (dev handle or Supabase email code), display name,
  channel list/create/join, the channel screen with a large hold-to-talk button,
  status banner (listening / receiving / requesting / transmitting / busy /
  connecting / reconnecting / disconnected / mic off), members with online and
  talking state, owner remove/block, invite sharing, audio output selection
  (Android output chips, iOS route picker), settings with the microphone and
  privacy explanation, open-settings, and delete account.
* Reconnect with backoff after disconnects. Turn release on app background.
* All acceptance tests that need phones: see `DEVICE_TEST_CHECKLIST.md`.

## Blocked

| Item | Blocker | What unblocks it |
|---|---|---|
| **Android development build (APK)** | The build environment has no Android SDK. Downloads from `dl.google.com` are denied by the egress policy (HTTP 403), and Maven Central returned 429 during Gradle resolution. | Build on a machine with Android Studio (see README §Android). Alternatively, with owner approval, an EAS cloud build (`eas build --profile development`) |
| iOS build | Needs macOS + Xcode and an Apple Developer team ($99/yr) for device installs | See README §iOS |
| Two-phone acceptance, latency on phones, routing, interruptions, network transitions | No physical devices here | Run `DEVICE_TEST_CHECKLIST.md` |
| Production deployment (TLS LiveKit, backend host, Supabase email OTP + SMTP) | Requires owner approval and paid or hosted resources | Owner decision; see `COSTS.md` |

## Planned

* Milestone 2 follow-ups: device verification (B1–B17), then possibly true
  hold-to-talk from a headset button (`MediaSession`).
* Milestone 3 follow-ups: first Xcode build and fixes, the device checklist
  P1–P14, measuring wake-up latency.
* Possible latency work: per-turn publish/subscribe costs ≈400 ms on loopback.
  Options are pre-warming the subscriber, or keeping a muted published track with
  server-side mute enforcement. Each is a security trade-off; measure on phones
  first.
* Optional E2EE (not implemented; the docs do not claim it).

## Background and locked screen

**Android background:** implemented in Milestone 2, **unverified on devices**.
**iOS background and locked screen:** implemented through PushToTalk in Milestone
3. The server side is tested; the iOS side has **never been compiled or run**.
