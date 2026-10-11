# Milestones 2 & 3 — background and locked-screen operation (investigation, NOT implemented)

**Status: planned. No background or locked-screen behaviour is implemented, and
none has been verified on a device.** The MVP is foreground-only on purpose:
when the app leaves the foreground it releases any turn.

Below is what was learned before committing to an approach. Sources: Apple's
PushToTalk documentation and developer-forum threads, and Android's
foreground-service documentation (links at the end). **Re-verify every item
against current platform docs when the milestone starts.**

## Milestone 2 — Android background

**Platform rules that shape the design:**
* Since Android 14, every foreground service must declare a type and hold the
  matching `FOREGROUND_SERVICE_*` permission. A PTT service needs
  `foregroundServiceType="microphone"` and
  `android.permission.FOREGROUND_SERVICE_MICROPHONE`. Playback-only would need
  `mediaPlayback`.
* `RECORD_AUDIO` is a *while-in-use* permission. A microphone-type foreground
  service **cannot be started while the app is in the background** (Android 12+),
  apart from narrow exemptions. Android 15 tightened the overlay exemption, which
  now requires a visible overlay window.
  * **Consequence:** the service must start while the app is visible. The
    natural moment is the user joining a channel. It then keeps running, with a
    persistent notification (for example "Walkie: connected to Site crew"), until
    the user leaves.
* Holding a microphone-type service with the mic **closed** is allowed. The mic
  is still opened only during a granted turn.

**Implementation sketch:**
1. Add a small Expo config plugin (or a local Expo module) that declares the
   service, its type and its permissions.
2. Start the service on join, stop it on leave.
3. Add a notification action "Hold to talk" (or a hardware or headset button via
   `MediaSession`) that calls the same request-turn path.

**SDK compatibility to verify on devices:**
* `@livekit/react-native` already runs a foreground service internally for
  screen-share (`mediaProjection`). Check that a second service (ours,
  `microphone`) coexists with it and with LiveKit's `AudioSwitch` audio-focus
  handling.
* The JS thread must stay alive in the background. With a foreground service
  running it generally does, but OEM battery managers (Samsung, Xiaomi) can still
  kill it. Test per vendor.

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
