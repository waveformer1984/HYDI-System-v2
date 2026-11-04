# Phone cannot open Heidi (`/heidi` or dashboard)

Cloud agents **cannot** reach `heidi-pc` on your tailnet. Fixes run **on heidi-pc** (Frank).

## Phone: one URL to test first

With Tailscale **Connected** on the phone, open:

**https://heidi-pc.tailc50af2.ts.net/api/ping**

| What you see | Meaning |
|---|---|
| `{"status":"alive","service":"heidi-web"}` | Serve + heidi-web work — open **/heidi** next |
| Timeout / “can’t reach server” | heidi-pc offline, Tailscale disconnected, or ACL blocks your phone |
| Certificate / SSL error | Rare on tailnet serve; update Tailscale app |
| 502 / Bad Gateway | heidi-web not listening on `:3000` |
| 404 JSON `Not found` | Wrong path or ingress gate (unlikely on `.ts.net` from tailnet) |

Chat URL (after ping works): **https://heidi-pc.tailc50af2.ts.net/heidi**

## heidi-pc: fix in one command

```powershell
cd C:\Users\Owner\HYDI-System-v2
git pull
powershell -ExecutionPolicy Bypass -File scripts\tailscale\diagnose-phone-access.ps1 -Fix
```

Then open `.runtime\phone-access-report.json` and paste it into Heidi chat if the phone still fails.

## Common causes when “neither link works”

1. **heidi-pc asleep or Tailscale disconnected on Frank** — wake PC; Tailscale tray icon must be connected.
2. **`tailscale serve` never set for 443 → 3000** — the `-Fix` script re-registers it.
3. **No production build** — `heidi-web-standalone` needs `npm run build` (`.next/BUILD_ID` missing).
4. **ACL `tag:hydi-host` on heidi-pc without a member grant** — phone loses all access; see `docs/TAILSCALE.md` §2.
5. **Home Wi‑Fi fallback** — same LAN: `http://<Frank-LAN-IP>:3000/heidi` (HTTP only; no install/PWA).

## Same Wi‑Fi (no Tailscale)

`http://192.168.x.x:3000/heidi` — find Frank’s LAN IP in Tailscale app → heidi-pc → details.
