# Phone key QR

Gets the phone's keys onto it without typing or copying them.

| Key | Why the phone needs it |
|---|---|
| `HYDI_BOARD_HUMAN_TOKEN` | posting to Forge Board as Jordan |
| `HYDI_PHONE_READ_TOKEN` | revenue summary and the Frank health card |
| `GROQ_API_KEY` | cloud AI backup (only if set on Frank) |
| `FRANK_HOSTS` | where to reach Frank (LAN, then Tailscale) |

## Use it

1. On Frank, open **http://127.0.0.1:3000/phone/provision** and tap **Show code**.
   It has to be opened on Frank itself; from any other device the button is refused.
   The code stays up until it expires (5 minutes, with a countdown), is used,
   or you tap **Hide now**.
2. On the phone, open the Hydi dashboard at **http://127.0.0.1:3006**, tap ⚙ →
   **Scan key QR**, then either:
   - point the camera at Frank's screen (or take a photo), or
   - **Paste code**: tap **Copy code** on Frank and paste it into the box, or type
     the 32-character short code shown under the QR (dashes, spaces and case
     don't matter), then tap **Import**.
3. The sheet shows which keys were saved. If the Groq key was among them,
   run `sv restart hydi-daemon` once.

### Away from home

Remote into Frank from the phone (Chrome Remote Desktop or Windows Remote
Desktop over Tailscale), open the page in Frank's browser and tap **Show code**.
If the remote-desktop app carries the clipboard over, use **Copy code** and
paste on the phone; otherwise type the short code. A typed short code goes to
the Frank addresses the phone already has (`FRANK_HOSTS`), so this route needs
one earlier import (or `FRANK_HOSTS` set by hand); the full copied code carries
the addresses itself.

## Why it's safe to show on screen

- The QR holds a **one-time code** that expires in 5 minutes, plus Frank's
  LAN/Tailscale addresses. It never contains a key. A photo of it is useless
  once it has been scanned or has expired. The text forms on Frank's page
  (Copy code, short code) are the same one-time code, nothing more.
- Codes are 160 random bits. Frank stores only their SHA-256, redeems each
  once (atomic rename), and rate-limits guessing.
- Issuing a code works only from Frank itself (loopback, `Host: 127.0.0.1`,
  plus a custom header, so other sites open in Frank's browser can't mint
  one). Redeeming works only from loopback, the LAN or the tailnet. Neither
  route is on the public-ingress allowlist, so the ngrok tunnel answers 404.
- Frank hands out only the three keys above, never anything else in `.env.local`.
- On the phone, the import endpoints answer only to the phone itself. Keys are
  written to `~/.hydi/thin-client.env` with mode 0600, existing lines are kept,
  and the dashboard only ever sees key **names**.

Code: `lib/phone/provision.js`, `lib/phone/provision-routes.js`,
`pages/phone/provision.tsx`, `pages/api/phone/provision/*`, and in `hydi.py`
`normalize_provision_input` / `provision_from_payload`.
