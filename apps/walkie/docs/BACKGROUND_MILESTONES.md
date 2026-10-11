# Milestones 2 & 3 — background and locked-screen operation

**Status:**
* **Milestone 2 (Android):** code exists. It has **not been run on a phone**, so
  background operation is still **unverified**. Details below.
* **Milestone 3 (iOS):** investigation only, not implemented.

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

## Milestone 3 — iOS background / locked screen

**Apple's PushToTalk framework** is the sanctioned route. The older
VoIP-push-for-PTT approach is deprecated, and forum replies note it is slated for
removal.

**Requirements:**
* The **Push to Talk capability/entitlement**. Apple must enable it for the team.
  Request it early; the timeline is outside our control.
* `UIBackgroundModes` including `push-to-talk`.
* Initialise `PTChannelManager` **at launch** so the system can restore channels.
* Join only from the foreground, through an explicit user action. The system then
  shows its own PTT UI on the lock screen and in the Dynamic Island.
* Incoming audio is announced by an **APNs push of type `pushtotalk`** (topic
  `<bundle-id>.voip-ptt`) to the channel's ephemeral push token. The app then
  calls `setActiveRemoteParticipant`.
  * **Needed:**
    * The backend must store per-channel PTT push tokens.
    * The backend needs an APNs auth key (`.p8`), team ID and key ID. These are
      server secrets.
    * The backend must send the push when a lease is granted.
* **Audio session ownership:**
  * The **system** activates the audio session and reports it through
    `channelManager(_:didActivate:)` and `didDeactivate`.
  * Apps must not activate it themselves. Forum reports show failures when they
    do.

**The SDK compatibility risk (the main open question):**
* `registerGlobals()` in `@livekit/react-native` 3.x by default *auto-configures
  and activates* the iOS audio session from WebRTC engine events. That conflicts
  directly with PushToTalk owning activation.
* The SDK offers `registerGlobals({ autoConfigureAudioSession: false })`, and
  `@livekit/react-native-webrtc` exposes `RTCAudioSession` / `AudioDeviceModule`.
  So the plan is:
  1. Disable auto-configuration.
  2. Bridge `didActivate` → tell WebRTC to start audio (manual-audio mode), and
     `didDeactivate` → stop it.
  3. Map "talk" in the system UI to our request-turn API, and our
     grant/release to `PTChannelManager.requestBeginTransmitting` /
     `stopTransmitting`.
* Whether WebRTC's audio unit starts correctly inside a PTT-activated session
  while locked **has not been verified** and is the first spike to run on a
  physical iPhone.
* Expect native Swift code (an Expo module). There is no maintained React Native
  PushToTalk package we could vet.

**Server changes for M3:**
* A `ptt_push_tokens` table.
* An APNs sender.
* On grant, push to the other members with the speaker's name.

## Sources
* Apple — [Creating a Push to Talk app](https://developer.apple.com/documentation/pushtotalk/creating-a-push-to-talk-app)
* Apple — [PTChannelManagerDelegate](https://developer.apple.com/documentation/pushtotalk/ptchannelmanagerdelegate)
* Apple Developer Forums — [PTT doesn't activate audio session in background](https://developer.apple.com/forums/thread/812592), [PushToTalk clarifications](https://developer.apple.com/forums/thread/711835), [Mic permission after force quit](https://developer.apple.com/forums/thread/781909)
* Android — [Foreground service types required (Android 14)](https://developer.android.com/about/versions/14/changes/fgs-types-required), [Restrictions on starting foreground services from the background](https://developer.android.com/about/versions/12/foreground-services)
* `@livekit/react-native` 3.0.0 README (bundled in `node_modules`): `registerGlobals({ autoConfigureAudioSession })`, `setupIOSAudioManagement`, Android screen-share foreground service
