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
