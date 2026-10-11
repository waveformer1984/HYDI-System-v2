# Estimated operating costs

> **Price caveat.** The official LiveKit pricing page could not be fetched from
> the build environment (DNS blocked). The LiveKit Cloud figures below come from
> third-party 2026 summaries that agree with each other (trtc.io, Fora Soft) and
> one snippet from livekit.com. Other aggregators conflict with them. **Verify on
> https://livekit.com/pricing before deciding.** Nothing here has been
> provisioned. Any paid plan needs owner approval.

## The cost driver for a walkie-talkie

LiveKit Cloud bills **participant-minutes: every minute a phone is connected
to a room, whether or not anyone is talking.** A walkie channel is "always
listening", so connected time, not talk time, dominates. Bandwidth from audio is
small.

**Assumptions:**
* Audio is Opus mono speech, about **48 kbit/s per stream on the wire** (≈32
  kbit/s Opus + redundancy + packet overhead). This is an assumption, not a
  measurement.
* Talk time is **5 %** of connected time.
* Channels have 5 members.
* Each member is connected **8 h/day, 22 days/month** (a work-shift pattern).
* Egress per talk-minute = (members − 1) × 48 kbit/s × 60 s = 1.44 MB.

| Scenario | Users | Participant-min/month | Egress/month | LiveKit Cloud (est.) | Self-hosted LiveKit (est.) |
|---|---|---|---|---|---|
| Pilot | 10 (2 channels) | 105,600 | ≈1.5 GB | **Ship $50/mo** (150k min, 250 GB incl.) | 1 small VM, ≈$10–40/mo |
| Team | 100 (20 channels) | 1,056,000 | ≈15 GB | Ship: $50 + 906k × $0.0005 ≈ **$500/mo**, or **Scale $500/mo** (≈1.5M min incl.) | 1–2 small VMs, ≈$20–80/mo |
| Org | 1,000 (200 channels) | 10,560,000 | ≈150 GB | Scale $500 + overage on ≈9M min: **several thousand $/mo** (overage rate unverified) | 2–4 VMs + bandwidth, ≈$100–400/mo |

Free tier ("Build", $0): about 5,000 participant-minutes. That is roughly 10
hours for one pair of phones, so it is enough for Milestone 1 testing only.

**Other costs:**

| Item | Cost | Notes |
|---|---|---|
| Walkie backend | ≈$0–20/mo | Tiny CPU/RAM needs. Can run beside HYDI on the existing machine, or on the same VM as LiveKit |
| Postgres / Supabase Auth | $0 local (already running for HYDI); Supabase Cloud Pro ≈$25/mo if hosted | Email OTP needs a working SMTP provider in production; Supabase's built-in mailer is rate-limited |
| TLS domain + certificate | ≈$10–15/yr domain; Let's Encrypt free | `wss://` is mandatory in production |
| TURN (for restrictive networks) | Included with LiveKit (embedded TURN/TLS on 443) when self-hosting with a domain | Without TURN, some corporate/cellular networks will fail to connect |
| Apple Developer Program | $99/yr | Required for any iPhone install outside a simulator, and for the PTT entitlement |
| Google Play Console | $25 one-time | Only for store distribution; dev APKs can be side-loaded |
| Expo EAS Build (optional) | Free tier exists; paid plans for more builds | Optional: local builds work with Android Studio / Xcode |

**Takeaway.** Use LiveKit Cloud's free or Ship tier for the two-phone pilot. Past
a few dozen always-connected users, self-hosting LiveKit (open source, Apache-2.0)
is roughly an order of magnitude cheaper. The server code needs no change for
that: only `LIVEKIT_URL` and the keys.

Sources: [livekit.com/pricing](https://livekit.com/pricing) (snippet only), [trtc.io LiveKit pricing 2026](https://trtc.io/blog/details/livekit-pricing-2026), [Fora Soft LiveKit vs Agora 2026](https://www.forasoft.com/blog/article/livekit-vs-agora-cost-analysis), [saaspricehub (conflicting figures)](https://saaspricehub.io/tools/livekit).
