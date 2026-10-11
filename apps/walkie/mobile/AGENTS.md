# Walkie mobile app — notes for coding agents

- Expo SDK 57 / React Native 0.86, development builds only (LiveKit needs
  native WebRTC; Expo Go cannot run it). `ios/` and `android/` are generated
  by `npx expo prebuild` from `app.config.ts` — never edit or commit them.
- Install native packages with `EXPO_OFFLINE=1 npx expo install <pkg>` so
  versions match the SDK.
- Navigation is a small state switch in `App.tsx` (no router) on purpose.
- All talk logic goes through the pure reducer in `src/ptt/machine.ts`;
  `src/ptt/useChannelSession.ts` only performs its effects. Keep it that way
  and extend `test/machine.test.ts` (incl. the fuzz invariant) for any change.
- Run `npm run typecheck && npm test` before declaring work done.
- Android background (Milestone 2) lives in the local Expo module
  `modules/walkie-background` (autolinked). Keep its service free of AndroidX
  so `gradle -p native-checks/android-service compileKotlin` can compile-check
  it without an Android SDK. Notification wording/Talk availability come from
  the pure `src/ptt/notification.ts` — test changes there.
- iOS PushToTalk (Milestone 3) lives in `modules/walkie-ptt` (Swift, never
  compiled in CI — there is no macOS runner). Keep `incomingPushResult` and
  channel restoration answered natively without JS or network. Event-to-action
  rules are in the pure `src/ptt/ios-ptt-policy.ts` — test changes there.
