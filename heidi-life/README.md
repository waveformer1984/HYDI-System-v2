# Heidi Life

Personal telemetry for Heidi: where you go, how you sleep, where your hours go across the ten divisions, and which of them actually pay — with Heidi proposing changes through the same triple gate as HYDI v3.

Everything is stored **locally on Frank** (SQLite). $0 to run. No cloud, no new accounts.

```
Samsung (Termux)                         Frank (Windows, :3470)
  location + battery every 5 min  ──LAN──▶  /ingest → SQLite
  offline queue when away                   visits · daily rollups · insights
  shows Heidi's notifications  ◀──────────  triple gate → notify / focus_block / journal
                                            dashboard at http://127.0.0.1:3470
  Google Calendar (secret iCal URL) ───────▶ hourly
  Stripe (restricted, read-only key) ──────▶ hourly
  Phone screen time (ADB, optional) ───────▶ hourly
  Ollama qwen2.5:3b (optional) ────────────▶ 9 PM digest in Heidi's voice
```

## Setup — Frank

1. Node 22.13+ (`node --version`). Copy this folder to `C:\ProtoForge_Ecosystem\heidi-life`.
2. `copy config.example.json config.json`, then edit:
   - `token`: `node -e "console.log(crypto.randomUUID())"`
   - `places`: your real Home (`isHome: true`), the Smokehouse, the shop — lat/lon from Google Maps (right-click → copy coordinates). Unnamed spots you visit a lot will be suggested to you.
   - `sources.calendarIcsUrls`: Google Calendar → Settings → your calendar → **Secret address in iCal format**.
   - `sources.stripe.restrictedKey`: Stripe → Developers → API keys → **Create restricted key** with only *Charges: Read* (`rk_live_…`). Full `sk_live_` keys are refused. Tag charges with metadata `division` for clean attribution.
   - `sources.adbUsage.enabled`: `true` once the phone is ADB-paired with Frank (the same setup as the phantom-process fix).
3. Allow the phone in (LAN only):
   `New-NetFirewallRule -DisplayName "Heidi Life (LAN)" -Direction Inbound -Protocol TCP -LocalPort 3470 -Profile Private -Action Allow`
4. Start: `powershell -File frank\start-heidi-life.ps1`, or paste its body into `start-heidi-everything.ps1`.

## Setup — phone

Install the **Termux:API** and **Termux:Boot** apps (same source as your Termux), then in Termux:

```
bash phone/install-phone.sh http://<FRANK_LAN_IP>:3470 <TOKEN>
```

In Android settings: Termux:API location → **Allow all the time**; Termux and Termux:API battery → **Unrestricted**. It runs as a runit service (`sv status heidi-life`), alongside `hydi`.

## The triple gate

| Gate | Where |
|---|---|
| 1 · `HEIDI_ALLOW_EXEC=true` | Frank's environment (off by default) |
| 2 · confidence ≥ 0.85 | per insight, rises with more days of data |
| 3 · inside `gate.bounds` | type allowlist + daily caps, quiet hours 10 PM–7 AM, focus blocks ≤ 2h, 8 AM–8 PM, no overlaps |

All three → **AUTO-APPROVE** and run. Bounds fail → **BLOCK**. Otherwise → **REVIEW**, approve on the dashboard (from Frank only; bounds still apply).

Heidi can only ever do three things: send you a phone notification, put a focus block on her own calendar (`/calendar/heidi.ics`), or write a journal entry. There is no code path to message other people, spend money, delete anything, or share your location — those can't be approved because nothing exists to run them.

## What she looks for

- **Revenue vs time** — best $/hour division, divisions eating hours with $0 → focus block for the earner
- **Sleep** (estimated from phone charging at home overnight) — short averages, drifting bedtime → wind-down nudge
- **Errands** — days with 3+ separate trips out → batching nudge
- **Screen** — social/video minutes per day
- **Movement** — home-all-day, under 1 km days → walk nudge
- **Calendar fragmentation** — short gaps → deep-work block
- **Unnamed places** you keep returning to → name them so time gets attributed

Insights start after about a week of data and each has a cooldown so it doesn't nag.

## Access from your phone, anywhere (Tailscale)

Heidi Life listens on Frank's LAN only. To reach it away from home without putting it on the internet, use Tailscale (free; you already use `tailscale cert` for HEIDI_TLS):

1. Install Tailscale on Frank and the Samsung, same account.
2. Point the collector at Frank's tailnet name so pings flow live instead of queueing until you're home: edit `~/.heidi-life/env` → `HEIDI_FRANK_URL=http://frank:3470` (or Frank's `100.x` address), then `sv restart heidi-life`.
3. Dashboard from the phone: `http://frank:3470/?token=<token>` — bookmark it.
4. To approve/reject from the phone too, set `"allowTailnetApprovals": true` in `config.json`. Approvals then work from Frank, or from a Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48) that also has the token. Never from the plain LAN or the internet. The audit log records which device approved.

Don't route this through the cloudflared tunnel — that makes your location history public, guarded only by the token.

## Good jobs for a Cursor background agent

Cursor agents work on this repo from cursor.com/agents on your phone and come back as PRs; they can't reach Frank or the phone. Pull on Frank afterwards.

- Link Heidi Life from the main Heidi dashboard (heidi-web, port 3000) and add it to `boot.config.json` / `start-heidi-everything.ps1`
- Gmail source: daily inbox volume and reply lag per division (read-only)
- Unit tests for `places.js` (visit detection) and `gate.js` (every bound)
- Reconcile with `DEEP_LIFE_ARCHITECT_README.md`: Deep Life Architect watches Frank's own activity; Heidi Life covers phone/location/calendar/revenue — feed its pillars into the daily rollup

## Privacy

- Raw GPS points are deleted after 90 days (`retention.rawPingDays`); visits and daily summaries stay.
- Pings, calendar, revenue and usage never leave Frank. The only outbound calls are to Google (your iCal URL) and Stripe (read-only).
- Back up `heidi-life.db` the same way you back up anything else sensitive — it's a precise history of your movements.

## Test

`npm run simulate` feeds two synthetic weeks through the HTTP API and prints every insight and gate verdict.
