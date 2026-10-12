# Milestones 2 & 3 — background and locked-screen operation

**Status:**
* **Milestone 2 (Android):** code exists. It has **not been run on a phone**, so
  background operation is still **unverified**. Details below.
* **Milestone 3 (iOS PushToTalk):**
  * Server side implemented and **tested** (APNs PushToTalk sender, token
    storage, leave pushes).
  * iOS side implemented but **not compiled and not run**: there is no
    macOS/Xcode or Swift toolchain here, and the build needs Apple's Push to
    Talk entitlement.

Sources: Apple's PushToTalk documentation and developer-forum threads, and
Android's foreground-service documentation (links at the end). **Re-verify
platform rules against current docs before shipping.**

## Milestone 2 — Android background (implemented, unverified)

### Platform rules that shaped the design
* Since Android 14 every foreground service declares a type and holds the
  matching `FOREGROUND_SERVICE_*` permission. Calling `startForeground` with a
  type whose runtime permission is missing throws `SecurityException`.
* `RECORD_AUDIO` is a *while-in-use* permission. A microphone-type foreground
  service **cannot be started from the background** (Android 12+). The narrow
  exemptions don't apply to us, and Android 15 tightened the overlay one.
* A microphone-type service may run with the microphone **closed**. Walkie opens
  the mic only during a granted turn.

### What was built
* **Local Expo module `mobile/modules/walkie-background`** (Android only,
  autolinked).
  * **`WalkieForegroundService`** uses only platform APIs, with no AndroidX.
    * Manifest type: `microphone|mediaPlayback`.
    * It starts with `microphone|mediaPlayback` when `RECORD_AUDIO` is granted,
      and with `mediaPlayback` only (listen-only) when it isn't, because Android
      14+ would throw otherwise.
    * It holds a bounded (8 h) partial wake lock so incoming audio is processed
      with the screen off.
    * `START_NOT_STICKY`: it never restarts on its own without the JS session
      that owns it.
    * A notification action that reaches it with no live session shuts it down.
  * **`WalkieBackgroundModule`** is a thin Expo bridge:
    * `start`, `update`, `stop`, `isRunning`, `hasMicrophoneType`
    * an `onServiceEvent` event: `started`, `start_failed`, `stopped`, `talk`,
      `stop_talk`, `leave`
  * **Permissions declared by the module:**
    * `FOREGROUND_SERVICE`
    * `FOREGROUND_SERVICE_MICROPHONE`
    * `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
    * `POST_NOTIFICATIONS`
    * `WAKE_LOCK`
* **`src/ptt/useBackgroundService.ts`:**
  * Starts the service after the room connects, and only while the app is
    visible. On Android 13+ it first asks for notification permission.
  * Restarts it in the foreground to add the microphone type once mic permission
    is granted.
  * Keeps the notification in step with the session: Listening, Receiving ·
    *name*, Transmitting, Busy, Reconnecting.
  * Stops the service when the user leaves the screen or turns the option off.
* **Notification actions** (the notification's text and when Talk appears come
  from the pure `src/ptt/notification.ts`, which is unit-tested):
  * **Talk** asks the server for a turn, exactly like the on-screen button. It
    appears only when connected, mic already granted (a permission dialog can't
    appear from a notification), nobody else talking, and not cooling down.
    Because nobody can *hold* a notification button, this turn is **latched**: it
    ends on **Stop talking**, at the server's maximum talk time (default 30 s,
    enforced by the server and by the client timer), or on any loss of the turn.
  * **Stop talking** ends the turn.
  * **Disconnect** leaves the channel screen. It does not leave the channel's
    membership.
* **On-screen presses end when the app is backgrounded.** Only a latched
  notification turn survives backgrounding (`releaseOnBackground`, unit-tested).
* **UI:** a "Stay connected in background" switch on the channel screen (on by
  default on Android) with an explanation, and a Background section in Settings.
* **iOS:** the module is absent, everything is a no-op, and iOS behaviour is
  unchanged (foreground only).

### Verified here
* The service compiles against the **Android 16 framework classes** (Robolectric
  `android-all` from Maven Central, warnings as errors), via
  `gradle -p apps/walkie/mobile/native-checks/android-service compileKotlin`.
  * A negative control (a non-existent API call) fails as expected.
  * CI job: `android-service` in `.github/workflows/walkie.yml`.
* Expo autolinking resolves the module
  (`expo.modules.walkiebackground.WalkieBackgroundModule`).
* Typecheck clean, 23 mobile tests pass, and the JS bundles for Android and iOS.

### NOT verified (needs a real build on a phone)
* `WalkieBackgroundModule.kt` (the Expo bridge) has not been compiled. It needs
  `expo-modules-core` and the Android toolchain, which this environment can't
  download (`dl.google.com` is blocked).
* That the manifest merges as intended, the service starts, the notification
  shows, and its actions reach JS.
* That audio keeps playing, and a latched turn can open the mic, with the app in
  the background and with the screen off.
* Coexistence with LiveKit's internal screen-share foreground service (unused
  here) and with `AudioSwitch` audio focus. Behaviour when another app takes
  audio focus.
* OEM battery managers (Samsung, Xiaomi, OnePlus) killing the process. Doze /
  App Standby with the screen off for long periods. Battery drain per hour.
* Lock screen: by default the notification's contents and actions are hidden on
  a secure lock screen (`VISIBILITY_PRIVATE`), so Talk from the lock screen
  needs an unlock. That is deliberate for privacy and not yet tested.

### Distribution note
* **Google Play** requires a foreground-service declaration for each type
  (`microphone`, `mediaPlayback`) in the Play Console, with a justification and
  usually a video. Side-loaded development builds do not need it.

### Possible next step (not started)
* True hold-to-talk in the background via a Bluetooth/wired headset button
  (`MediaSession` key down/up), instead of the latched notification button.

## Milestone 3 — iOS PushToTalk (server tested; iOS code unverified)

### Platform rules (from Apple's "Creating a Push to Talk app" and API reference, re-checked 2026-10-11)
* **Capabilities:**
  * the Push to Talk capability: entitlement `com.apple.developer.push-to-talk`
    (boolean, iOS 16+; key confirmed in Apple's entitlement reference
    2026-10-12). Apple's guide enables it with Xcode → Add Capability → Push to
    Talk and mentions no separate approval. Whether a given account offers it
    is unverified;
  * Background Modes → Push to Talk (`UIBackgroundModes: push-to-talk`);
  * Push Notifications (`aps-environment`);
  * `NSMicrophoneUsageDescription`.
* **Channel manager:** create it **as early as possible at launch**. Repeated
  calls return the same shared instance. It restores a joined channel and
  delivers pushes after a relaunch.
* **Joining:** only from the **foreground with an explicit user action**.
  `requestJoinChannel(channelUUID:descriptor:)`. One active channel at a time.
* **Push token:** an **ephemeral push token** arrives via
  `receivedEphemeralPushToken`. It becomes active once the user joins.
* **Pushes from the server:** `apns-push-type: pushtotalk`, topic
  `<bundleId>.voip-ptt`, priority 10, expiration 0. The payload holds custom
  keys. `incomingPushResult` must answer *immediately* with
  `.activeRemoteParticipant(PTParticipant)` or `.leaveChannel`.
* **Audio:** the **system activates the audio session**. The app must not
  activate it itself, and may record only after
  `channelManager(_:didActivate:)`.
* **Half-duplex** is the default transmission mode: the system blocks
  transmitting while receiving. That matches Walkie's single-speaker server
  rule.

### What was built
**Server (`apps/walkie/server`): implemented and tested**
* **Tokens:** migration `002_ptt_push_tokens.sql`, one token per
  (channel, member).
  * `PUT` / `DELETE /v1/channels/:id/ptt-token`, members only; delete is always
    allowed.
  * Tokens are deleted when a member is removed or blocked, when the channel or
    the account is deleted, or when APNs answers 410 / `BadDeviceToken` /
    `DeviceTokenNotForTopic`.
* **`src/apns.ts`:**
  * Token-based APNs authentication (`.p8` key, ES256 JWT with kid and team,
    reused for 40 minutes).
  * One reused HTTP/2 session per host.
  * Exactly the headers above.
* **`src/ptt-notifier.ts`:**
  * On every **new** turn, it pushes
    `{activeSpeaker, speakerUserId, channelId, leaseId}` to every *other* member
    with a token. This is fire-and-forget: a push failure never affects the
    grant.
  * Removal, block, channel deletion and account deletion push `{leave: true}`
    to the affected devices first.
* **Config:** `APNS_KEY_P8` (or `APNS_KEY_FILE`), `APNS_KEY_ID`,
  `APNS_TEAM_ID`, `APNS_BUNDLE_ID`. Give all four or none; with none, pushes
  are disabled and tokens are still stored.

**iOS (`apps/walkie/mobile`): implemented, never compiled**
* **Local Expo module `modules/walkie-ptt`** (Apple only, autolinked; links
  `PushToTalk` and `AVFoundation`).
  * `PttController` owns the single `PTChannelManager`. It is created in the
    module's `OnCreate`, i.e. at app start.
  * It answers `incomingPushResult` and channel restoration from the push
    payload and a `UserDefaults` cache. It never waits for JavaScript.
  * It sets the `playAndRecord` / `voiceChat` category (with speaker and
    Bluetooth) on join, **without activating** the session.
  * It forwards join/leave, transmit begin/end (with the source), the push
    token, pushes, audio activation and errors to JS.
* **Audio ownership:**
  * `index.ts` now calls `registerGlobals({ autoConfigureAudioSession: false })`.
  * `src/ptt/ios-audio-mode.ts` turns LiveKit's default `setupIOSAudioManagement()`
    on, which reproduces the previous behaviour exactly. It hands the session to
    PushToTalk while a PTT channel is joined.
  * `didActivate` / `didDeactivate` are passed to WebRTC through
    `RTCAudioSession.audioSessionDidActivate` / `...DidDeactivate`, the same
    hooks used for CallKit.
* **`src/ptt/useIosPtt.ts`:**
  * A **"Turn on lock-screen talk"** button on the channel screen (the explicit
    user action Apple requires). It registers the token with the server.
  * A **mic gate**: while joined, the mic opens only after `didActivate`, with a
    2.5 s timeout that ends the turn.
  * An on-screen press also calls `requestBeginTransmitting`.
  * **Talk in the system UI** (lock screen, Dynamic Island, or an accessory
    button) starts a *latched* turn through the same server arbitration. The
    latched turn ends when the system ends it, at the max talk time, or when the
    turn is lost.
  * The system UI's speaker follows the server's speaker.
  * Connection health is reported with `setServiceStatus`.
  * One PTT channel at a time: opening another channel leaves the old one.
* **Cold start:** if iOS relaunched the app for a push or restoration, `App.tsx`
  opens the restored channel directly.
* **Policy:** `src/ptt/ios-ptt-policy.ts` is pure and unit-tested.
* **Build:** opt-in with `WALKIE_IOS_PTT=1`. It adds the entitlement,
  `aps-environment` and the background mode. Without the flag, the build is
  unchanged and signs without the special entitlement.
* **Fix found while testing:** latched turns (Android notification and iOS
  system UI) now release when the turn ends on the server side. Before this,
  the next Talk tap was silently ignored. Covered by
  `latchedShouldRelease` tests.

### Verified here
* Server: 79 tests on the memory store and real Postgres 16, including 15 new
  PTT tests.
  * A local HTTP/2 server stands in for APNs and checks the headers, the path,
    and the ES256 JWT (signature, kid, issuer).
  * They also cover the dead-token classification, fan-out that excludes the
    speaker, no repeat push for a re-requested turn, leave pushes on
    remove/block/delete/account deletion, and that a failed push doesn't block
    the grant.
  * The Postgres run caught a real bug: the migration's `{16,512}` regex
    exceeds Postgres's repetition limit of 255. Fixed with a length check.
* The real-LiveKit suite still passes: 10/10.
* Mobile: typecheck clean; 29 tests pass (including the iOS PTT policy and the
  latch fix); both JS bundles build.
* Expo autolinking resolves `WalkiePtt` for iOS.
* `expo prebuild --platform ios`:
  * with `WALKIE_IOS_PTT=1`: `UIBackgroundModes: [push-to-talk]`, plus
    entitlements `com.apple.developer.push-to-talk` and
    `aps-environment: development`;
  * without it: none of these.
* API names and enum cases were checked against Apple's documentation data:
  `requestJoinChannel`, the delegate signatures, `PTChannelTransmitRequestSource`
  and `PTServiceStatus` cases, `.allowBluetoothHFP`.

### NOT verified (needs a Mac, Xcode, an Apple team with the entitlement, and iPhones)
* **The Swift has never been compiled.** There is no Swift toolchain here.
  Expect small fixes on the first Xcode build.
* Whether the team's Apple Developer account offers the Push to Talk
  capability without a separate request (Apple's guide implies it does).
* **The main technical risk:** LiveKit's WebRTC audio unit starting inside a
  PushToTalk-activated session through the CallKit-style hooks.
  * In foreground and background, and on a locked phone.
  * Including whether `useManualAudio` / `isAudioEnabled` must also be set on
    `LKRTCAudioSession`. The RN package exposes only the activate/deactivate
    hooks.
* **Wake-up latency.** A suspended app woken by a push must reconnect to
  LiveKit before audio flows. The first words of a turn will likely be lost
  while that happens. This needs measuring. A server-side "pre-roll" buffer
  would be a larger change.
* Foreground behaviour while joined: receiving needs
  `setActiveRemoteParticipant` → `didActivate` before playback. Whether
  LiveKit playback starts cleanly after that.
* Apple's push budget and behaviour for frequent turns. Apple documents a
  "high-priority budget" only for service-update pushes.

## Sources
* Apple — [Creating a Push to Talk app](https://developer.apple.com/documentation/pushtotalk/creating-a-push-to-talk-app), [PTChannelManager](https://developer.apple.com/documentation/pushtotalk/ptchannelmanager), [PTChannelManagerDelegate](https://developer.apple.com/documentation/pushtotalk/ptchannelmanagerdelegate), [PTPushResult](https://developer.apple.com/documentation/pushtotalk/ptpushresult), [PTChannelRestorationDelegate](https://developer.apple.com/documentation/pushtotalk/ptchannelrestorationdelegate) (fetched 2026-10-11)
* Apple — [Creating a Push to Talk app](https://developer.apple.com/documentation/pushtotalk/creating-a-push-to-talk-app)
* Apple — [PTChannelManagerDelegate](https://developer.apple.com/documentation/pushtotalk/ptchannelmanagerdelegate)
* Apple Developer Forums — [PTT doesn't activate audio session in background](https://developer.apple.com/forums/thread/812592), [PushToTalk clarifications](https://developer.apple.com/forums/thread/711835), [Mic permission after force quit](https://developer.apple.com/forums/thread/781909)
* Android — [Foreground service types required (Android 14)](https://developer.android.com/about/versions/14/changes/fgs-types-required), [Restrictions on starting foreground services from the background](https://developer.android.com/about/versions/12/foreground-services)
* `@livekit/react-native` 3.0.0 README (bundled in `node_modules`): `registerGlobals({ autoConfigureAudioSession })`, `setupIOSAudioManagement`, Android screen-share foreground service
