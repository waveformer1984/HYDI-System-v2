# Post-merge validation record — 2026-10-12

* **Baseline:** `clean-main` @ `afcc7b1` (#326, after the Walkie merge `6a1a52d` #325).
* **Environment:** Claude Code cloud container (Linux).
  * No Android SDK: `dl.google.com` is denied by the egress policy.
  * No macOS, Xcode or Swift.
  * No Tailscale: `login.tailscale.com`, `pkgs.tailscale.com` and `*.ts.net`
    are denied by the egress policy, and no auth key is provided.
  * No `adb`, no SSH keys, **no physical device**.

Statuses:
* **PASS:** executed here with the evidence shown.
* **BLOCKED:** needs something this environment cannot reach.
* **Not run:** nothing attempted.

Nothing below is a device result unless it says so, and none does.

## Automated results (executed)

| Check | Result |
|---|---|
| Walkie server typecheck + 79 tests, Postgres 16 + memory | PASS 79/79 |
| Walkie server against real LiveKit 1.13.9 (WebRTC clients) | PASS 10/10 |
| Walkie mobile typecheck + 29 tests | PASS 29/29 |
| Android FGS compile check vs Android 16 framework classes (`native-checks/android-service`) | PASS (`BUILD SUCCESSFUL`) |
| Mobile-ops + Heidi Mobile suites (incl. new jobs tests) | PASS 91/91 |
| Root `tsc --noEmit` | PASS |
| Root full Jest | 455 suites pass, 11 fail. The **same 11 fail on unmodified `clean-main`** (pre-existing, e.g. `browser-post-reply`, `no-hardcoded-secrets`). No new failures. |
| Android APK build (`expo prebuild` + `gradlew assembleDebug`) | **BLOCKED**: no Android SDK here |
| iOS build (`WALKIE_IOS_PTT=1`) | **BLOCKED**: no macOS/Xcode |

## Android B1–B17

Every B item needs an installed APK on a physical Android phone, so all are
**BLOCKED** here. The automated column names the tests that cover the *logic*
behind each item. That is not a substitute for the device run.

| # | Status | Automated coverage of the underlying logic |
|---|---|---|
| B1 Service starts on join | BLOCKED | FGS compiles; manifest declares the service (prebuild); start path in `useBackgroundService` |
| B2 Mic denied → listen-only | BLOCKED | `foregroundTypes(micGranted=false)` → `mediaPlayback` only (compiled); `notification.test.ts`: no Talk without mic |
| B3 Mic granted later | BLOCKED | Restart-with-microphone-type effect (code only) |
| B4 Receive in background | BLOCKED | none on device |
| B5 Receive, screen off 10 min | BLOCKED | none (wake lock compiled only) |
| B6 Talk from notification | BLOCKED | server grant/revoke: real LiveKit 10/10; latched turn: `notification.test.ts` |
| B7 Latched turn cap | BLOCKED | `latchedShouldRelease` + max-duration tests; server max duration on real LiveKit |
| B8 Busy from notification | BLOCKED | `notificationContent` busy/receiving tests |
| B9 On-screen press then Home | BLOCKED | `releaseOnBackground` tests |
| B10 Connectivity loss in background | BLOCKED | renew-TTL cutoff on real LiveKit (≈1.7 s at TTL 2 s) |
| B11 Disconnect action | BLOCKED | none on device |
| B12 Toggle off | BLOCKED | none on device |
| B13 Swipe app away | BLOCKED | `START_NOT_STICKY` (compiled) |
| B14 Phone call | BLOCKED | none |
| B15 Battery | BLOCKED | none |
| B16 Locked screen | BLOCKED | none |
| B17 OEM kill (Samsung) | BLOCKED | none |

**To unblock:** an Android build host (Android Studio or SDK + JDK 17+) with a
phone attached by USB. Then:
1. Build: `APP_VARIANT=development npx expo run:android --variant debug` in
   `apps/walkie/mobile`. Alternatively, start the new `walkie.android.build`
   job from Heidi Mobile on the HYDI PC.
2. Install the APK on two phones.
3. Run B1–B17 and record the results here.

## iOS P1–P14

| # | Status | Notes |
|---|---|---|
| P1 First Xcode build | BLOCKED | No macOS/Xcode reachable. The Swift has never been compiled. |
| P2–P14 | BLOCKED | Need P1, plus an app ID with the Push to Talk capability, an APNs key on the backend, and two iPhones |

**Validated without Apple credentials:**
* The entitlement key `com.apple.developer.push-to-talk` (boolean, iOS 16+) is
  confirmed against Apple's entitlement reference.
* Apple's "Creating a Push to Talk app" enables it via Xcode → Add Capability →
  Push to Talk and mentions no separate approval process. Docs corrected
  accordingly (earlier text said "Apple must approve").
* `expo prebuild --platform ios` with `WALKIE_IOS_PTT=1` emits:
  * the entitlements `com.apple.developer.push-to-talk: true` and
    `aps-environment: development`;
  * `UIBackgroundModes: [push-to-talk]`.
* PushToTalk API names and enum cases match Apple's documentation data.
* The server-side APNs sender passes 15 tests against a local HTTP/2 stand-in:
  headers, ES256 JWT, dead-token handling, leave pushes.

## CI evidence (Phase 5)

* **Push-triggered workflows on `clean-main` @ `afcc7b1`** (Unit Tests,
  Integration Tests, CodeQL, Deploy Pages): all failed in ~4 s. The Unit Tests
  run's usage reports `billable.UBUNTU.total_ms = 0`, with one job of
  `duration_ms: 0`. Job metadata shows `runner_id: 0` (no runner assigned).
* **Dependabot jobs on the same day ran normally.** Job `114604710076` got
  `runner_id: 1000009570`, label `ubuntu-latest`, and ran 72 s. Dependabot
  updates are not billed to the account's Actions minutes.
* **Conclusion:** runners are available. Billable Actions usage is blocked at
  the account or billing level: a spending limit, a payment method, or an
  Actions policy. It is not an application test failure.
* **Needs an account owner to check:**
  * github.com → Settings → Billing and plans → Spending limits / payment
    method for Actions;
  * the repository → Settings → Actions → General.
* After the fix, any push re-triggers the workflows. Verify that jobs show a
  non-zero `runner_id` and real step output.

**Separate, real finding:** the Dependabot security update for
`apps/walkie/mobile` failed.
* `uuid` was pinned at 7.x by `xcode@3.0.1`.
* `braces` and `node-forge` have no patched releases.
* **Fixed here** with an npm override `uuid@^11.1.1`. `xcode` only calls
  `uuid.v4()`, which v11 provides. `expo prebuild --platform ios` still
  succeeds and mobile tests stay 29/29. The moderate advisories go from 7 to 0.
* The 16 remaining "high" advisories have no non-breaking fix (`npm audit`
  suggests downgrading Expo to 44). All are build-time or dev-server
  dependencies, not shipped in the app.
