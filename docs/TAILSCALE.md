# Tailscale: reaching the HYDI PC from phone and agents

**Local sync contract:** phone clients use the same `api/mobile-status` and `api/hydi/sync` payloads whether they hit Frank over tailnet or legacy Vercel — see `docs/LOCAL_SYNC_CONTRACT.md`.

Tailnet `tailc50af2.ts.net`. The HYDI PC is `heidi-pc` (Windows 11, canonical
tree `C:\Users\Owner\HYDI-System-v2`). **Everything here is tailnet-only
except the walkie backend on :8443** (see the table). **Never enable Tailscale Funnel
for any other port**: the protoforge tools include
Stripe balances, and nothing else should be reachable from the public internet.

## What is exposed

| Tailnet URL | Local target | What | Auth |
|---|---|---|---|
| `https://heidi-pc.tailc50af2.ts.net/` (443) | `127.0.0.1:3000` | heidi-web, incl. `/heidi` phone PWA | device pairing (`docs/HEIDI_MOBILE.md`) |
| `https://heidi-pc.tailc50af2.ts.net:8470/mcp` | `127.0.0.1:3470` | protoforge MCP server (read-only tools) | `Authorization: Bearer <PROTOFORGE_MCP_TOKEN>` |
| `https://heidi-pc.tailc50af2.ts.net:8443/` **(public, Funnel)** | `127.0.0.1:8787` | ProtoForge Walkie backend + browser walkie, so invite QRs work for phones off the tailnet. The one deliberate exception, approved 2026-10-13; `scripts/tailscale/funnel-walkie.ps1` refuses to run if Funnel is on any other port | invite codes / guest + owner sessions (`apps/walkie/docs/QR_JOIN.md`) |

`GET :8470/healthz` is unauthenticated and returns only name and version.
`tailscale serve` config persists across reboots.

## 1. Serve the MCP server (on heidi-pc)

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -ExecutionPolicy Bypass -File scripts\tailscale\serve-mcp.ps1
```

The script is idempotent. It:
- generates `PROTOFORGE_MCP_TOKEN` into `.env.local` if missing (never displays it)
- installs `mcp/protoforge-mcp` dependencies if needed
- registers a per-user logon Scheduled Task **"ProtoForge MCP HTTP"**, the same
  pattern as "HYDI Boot Agent". It runs `scripts\tailscale\run-mcp-http.cmd` and
  logs to `logs\protoforge-mcp.log`.
- runs `tailscale serve --bg --https=8470 http://127.0.0.1:3470`, leaving the
  443 → 3000 heidi-web serve alone
- verifies that `/healthz` answers and that `/mcp` without a token returns 401

**Rollback:** `scripts\tailscale\serve-mcp.ps1 -Remove` turns off only the 8470
serve and removes the task.

## 2. Tailnet policy (admin console, applied by hand)

Tag the HYDI PC so agents can be scoped to it: admin console → **Machines** →
`heidi-pc` → **Edit ACL tags** → `tag:hydi-host`.

> ⚠️ A tagged machine stops being "your device". If your policy relies on
> `autogroup:self` or user-owned devices for phone → heidi-pc access, add the
> first grant below **before** tagging, or the phone loses access.

Merge into the policy file:

```json
"tagOwners": {
  "tag:hydi-host": ["autogroup:admin"],
  "tag:agent":     ["autogroup:admin"]
},
"grants": [
  // your own devices (phone, laptops) keep full access to the HYDI PC
  { "src": ["autogroup:member"], "dst": ["tag:hydi-host"], "ip": ["*"] },
  // cloud agents may reach ONLY the MCP port, nothing else
  { "src": ["tag:agent"], "dst": ["tag:hydi-host"], "ip": ["tcp:8470"] }
]
```

`tag:agent` gets no other grants, so agents can't reach each other, your phone,
or any other port on heidi-pc.

## 3. Cloud agents (Cursor cloud agents, etc.)

1. Admin console → **Settings → Keys → Generate auth key**: **Ephemeral** on,
   **Reusable** on, **Tags** `tag:agent`, with a short expiry.
2. Store it as a secret named `TS_AUTHKEY` in the agent platform (e.g. Cursor
   cloud-agent secrets). Never commit it.
3. In the agent's setup step:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh   # if not preinstalled
   scripts/tailscale/agent-join.sh
   ```
   If a `tailscaled` is already running (the installer starts one), the script
   reuses it. Otherwise, root with a usable `/dev/net/tun` gets normal
   networking and MagicDNS. If the tunnel can't be created (common in
   containers), the script falls back to **userspace** mode, where tailnet hosts
   are reachable only through the proxies it starts (SOCKS5 `localhost:1055`,
   HTTP `localhost:1056`). Clients that don't use a proxy, including many MCP
   clients, won't connect in that mode.
4. Give the agent `PROTOFORGE_MCP_TOKEN` as a separate secret if it should call
   the MCP tools.

Ephemeral nodes disappear from the tailnet shortly after the VM is gone.

> Some agent sandboxes allowlist outbound traffic and block Tailscale's control
> plane entirely. If `tailscale up` hangs, the platform's network policy is the
> blocker, not this script.

## 4. Phone (Android / Termux edge node)

- The Tailscale Android app is already on the phone (`felicias-microwave`, always-on VPN).
- Heidi PWA: open `https://heidi-pc.tailc50af2.ts.net/heidi`.
- Termux thin client: replace the hardcoded LAN IP in
  `~/.termux/boot/start_hydi.sh` (`FRANK_IP=192.168.1.100`) with the MagicDNS
  name `heidi-pc.tailc50af2.ts.net`, so it works off home Wi-Fi.
- Ollama for the phone: keep Ollama bound to localhost and add a tailnet-only
  serve on heidi-pc, rather than binding Ollama to `0.0.0.0`:
  `tailscale serve --bg --https=11434 http://127.0.0.1:11434`.
  The phone then uses `https://heidi-pc.tailc50af2.ts.net:11434`.

## 5. Shell access to heidi-pc

Tailscale SSH's server side doesn't run on Windows. For remote shell on heidi-pc,
either keep the Claude desktop app open there so Claude sessions can use the
linked computer, or enable Windows OpenSSH Server and reach it over the tailnet
only. If you take the second route, restrict it with a grant, as in section 2.

## Heidi chat not loading on the phone

Run on **heidi-pc** (diagnose, then fix):

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -ExecutionPolicy Bypass -File scripts\tailscale\diagnose-phone-access.ps1
powershell -ExecutionPolicy Bypass -File scripts\tailscale\diagnose-phone-access.ps1 -Fix
```

`-Fix` runs `scripts/tailscale/serve-heidi-web.ps1`: restarts `heidi-web-standalone` (or
`hydi-boot`) if `:3000/api/health` fails, then `tailscale serve --bg --https=443 http://127.0.0.1:3000`.

Phone chat URL: **`https://heidi-pc.tailc50af2.ts.net/heidi`** (requires Tailscale + pairing).

## Verify

```powershell
tailscale serve status
curl.exe -s -o NUL -w "local health %{http_code}\n" http://127.0.0.1:3000/api/health
curl.exe -s -o NUL -w "tailnet /heidi %{http_code}\n" https://heidi-pc.tailc50af2.ts.net/heidi
curl.exe -s https://heidi-pc.tailc50af2.ts.net:8470/healthz
curl.exe -s -o NUL -w "%{http_code}" -X POST https://heidi-pc.tailc50af2.ts.net:8470/mcp   # expect 401
```
