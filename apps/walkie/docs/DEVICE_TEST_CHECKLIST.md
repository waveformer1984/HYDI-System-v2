# Physical-device test checklist (Milestone 1: foreground, two phones)

**Nothing on this list has been executed yet.** No physical phones were available
to the build environment. Fill in the "Result" column with date, devices, OS
versions, network and an observation. "Pass" without evidence does not count.

**Setup:**
* Phone A and Phone B (ideally one Android, one iPhone) running a development
  build.
* Backend and LiveKit reachable (see the README).
* A third device to film both screens and speakers for latency (a 240 fps
  slow-motion video is ideal).

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Sign in & name | Sign in on both phones; set display names | Channels screen shows your name | |
| 2 | Create + invite | A creates channel, taps *Invite someone*, shares code; B joins with code | Both see each other in Members, "online" | |
| 3 | No auto-transmit | Both open the channel and wait 30 s | Status "Listening"; **no OS mic indicator** on either phone | |
| 4 | Intelligible audio | A holds Talk and reads a sentence; swap | B hears it clearly; status on B shows "Receiving" + A's name | |
| 5 | Release stops TX | A holds, speaks, releases mid-word while continuing to speak | B's audio stops at release; A's mic indicator turns off within ~1 s | |
| 6 | Simultaneous press | Count down, both press at once (×10) | Exactly one gets "You are transmitting", the other "Busy"; never both | |
| 7 | Max duration | Hold Talk for > 30 s | Transmission stops at ≈30 s with "Maximum talk time reached" | |
| 8 | Mic denied | Fresh install on A; deny microphone; press Talk | Explanation + *Open settings* button; app keeps listening; no crash | |
| 9 | Mic revoked mid-session | Revoke mic in OS settings while app is open, return, press | Same as 8 | |
| 10 | Speaker output | Both on speakerphone (default) | Audio from loudspeaker, not earpiece | |
| 11 | Wired headphones | Plug in on B during A's talk | Audio moves to headphones; unplug → back to speaker | |
| 12 | Bluetooth | Pair a BT headset on B; Android: grant Nearby devices; use output chips / iOS route picker | Audio in BT headset; B's talk uses BT mic (note if HFP quality drop occurs) | |
| 13 | Interruption: phone call | Call phone B during a session | Audio pauses for the call; after hang-up B hears A again (record whether a rejoin was needed) | |
| 14 | Interruption: other app audio | Play music on B, then A talks | Record behaviour (ducking / pause / mix) | |
| 15 | Wi-Fi → cellular | A on Wi-Fi in a channel; turn Wi-Fi off | Status "Reconnecting…" then "Listening" on cellular; record seconds | |
| 16 | Cellular → Wi-Fi | Reverse of 15 | Same | |
| 17 | Connectivity loss while talking | A holds Talk, enable airplane mode on A | A's status stops transmitting; **B can take the turn within ≈5 s** (renew TTL); no stuck "Receiving" on B | |
| 18 | Kill app while talking | Force-quit A mid-talk | B can talk within ≈5 s | |
| 19 | Owner removes / blocks | A long-presses B → Remove; then invite again and Block | B returns to "no longer a member"; blocked B cannot rejoin with a new code | |
| 20 | Unauthorized | C (not invited) tries to join with an old/used code | "That invite code does not work" | |
| 21 | Background (MVP behaviour) | A holds Talk then presses Home | Transmission stops; record whether A keeps *receiving* in background (expected: unverified / platform-dependent) | |
| 22 | Locked screen | Lock B while A talks | Record result; **locked-screen receive is NOT a supported MVP feature** | |
| 23 | Delete account | Settings → Delete account on B | B signed out; A sees B gone; B's owned channels gone | |

## Latency measurement (press-to-audible)

1. Film both phones with the third device (slow-motion if possible).
2. On A, tap the Talk button and immediately say a sharp "ta".
3. Count frames from the finger touching the screen to the first sound from B's
   speaker. Also note the in-app line "Last turn: press→grant X ms, grant→mic
   live Y ms" on A.
4. Repeat 10× on Wi-Fi (both phones on the same Wi-Fi) and 10× with A on
   cellular. Report median and worst.

**Reference (not a phone measurement).** On loopback (one machine, real LiveKit
1.13.9, Node WebRTC clients, no mic capture, no speaker playout, no radio), the
results were:
* press→grant: 15–65 ms
* press→first audible frame at the listener: **≈410–450 ms**, of which ≈380–430 ms
  is LiveKit's publish→subscribe path for a newly published track

Phones will be slower. See `docs/results/`.

# Milestone 2 checklist (Android background) — NOT yet executed

Requirements: an Android development build that includes
`modules/walkie-background`. Test on at least one Pixel (stock Android 14+)
and one Samsung, and record model, OS version and battery setting
("Unrestricted" / "Optimized") for each.

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| B1 | Service starts on join | Join a channel with the app open (Android 13+: allow notifications) | Ongoing "Walkie connection" notification: channel name, "Listening", buttons Talk + Disconnect | |
| B2 | Mic denied → listen-only | Fresh install, deny mic, join | Notification shows "Listening (microphone off)", **no Talk button**; app does not crash | |
| B3 | Mic granted later | In B2, allow mic via the on-screen prompt | Talk button appears (service restarted with microphone type) | |
| B4 | Receive in background | Phone A joins, presses Home; B talks | A plays B's audio; A's notification shows "Receiving · B" | |
| B5 | Receive with screen off | As B4, screen off for 10 min, B talks every minute | Every transmission audible on A; record any missed ones | |
| B6 | Talk from notification | A backgrounded; tap Talk; speak; tap Stop talking | B hears A only between Talk and Stop; notification shows "Transmitting"; OS mic indicator on only during that window | |
| B7 | Latched turn cap | Tap Talk and do not tap Stop | Transmission ends at the maximum talk time (default 30 s); notification returns to Listening | |
| B8 | Busy from notification | B is talking while A is backgrounded | No Talk button while B talks (Receiving); after B releases, Talk reappears | |
| B9 | On-screen press then Home | Hold the on-screen button, press Home while holding | Transmission stops | |
| B10 | Connectivity loss in background | A latched-talking, airplane mode on A | B can talk within ≈5 s; A's notification shows Reconnecting, then recovers when back online | |
| B11 | Disconnect action | Tap Disconnect | Notification gone; A no longer in channel (B sees A offline); A still a member | |
| B12 | Toggle off | Turn "Stay connected in background" off, press Home | Notification gone; audio stops in background | |
| B13 | Swipe app away | Remove Walkie from recents while connected | Record: service/notification behaviour and whether B sees A leave | |
| B14 | Phone call | Incoming call while backgrounded and connected | Record audio behaviour during and after the call | |
| B15 | Battery | 1 h connected in background, screen off, a few transmissions | Record battery % used vs. an idle baseline | |
| B16 | Locked screen | Secure lock screen, check notification | Contents and actions hidden until unlock (privacy default); record actual behaviour | |
| B17 | OEM kill | Samsung with default battery settings, 30 min background | Record whether Walkie stays connected | |
