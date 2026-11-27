# Heidi phone troubleshooting

Quick read-only checks from a phone (Termux) against the Heidi Mobile stack on the tailnet — no device pairing, cookies, or secrets required.

## One-command check

From the repo root on Termux (or any host with `curl` and `sh`):

```bash
pkg install curl   # Termux, once
chmod +x scripts/phone/heidi-check.sh
HEIDI_TAILNET_URL=https://heidi-pc.tailc50af2.ts.net scripts/phone/heidi-check.sh
```

`HEIDI_TAILNET_URL` defaults to `https://heidi-pc.tailc50af2.ts.net` when unset. Trailing slashes are stripped automatically.

On Android Termux, the script may not see a `100.x` address via `ip`/`ifconfig` even when Tailscale is connected. Set `HEIDI_TAILNET_URL` explicitly (for example `http://100.x.x.x:3000` from the Tailscale app, or MagicDNS) so the check probes that URL instead of exiting early with `PHONE_OFF_TAILNET`. When the URL is explicit and no local `100.x` is detected, you get a one-line `WARN` and the curls still run. The hard exit only applies when you rely on the default MagicDNS URL and the device looks off-tailnet.

### What it probes (GET, no query strings)

| Check   | URL |
|---------|-----|
| health  | `$HEIDI_TAILNET_URL/api/health` |
| heidi   | `$HEIDI_TAILNET_URL/heidi` |
| state   | `$HEIDI_TAILNET_URL/api/heidi-mobile/state` |

### Verdict lines

Each line is printed as: `name code <seconds>s verdict`

| Condition | Verdict text |
|-----------|----------------|
| HTTP 200 | `OK` |
| `state` only, HTTP 503 | `BFF up, upstream down (Supabase?)` |
| HTTP `000` / connection failure | `unreachable — host not responding` |
| Response time over 6s | `slow — response took over 6s` |
| Anything else | `unexpected HTTP <code>` |

### Exit status

| Outcome | Final line | Exit code |
|---------|------------|-----------|
| All three OK | `ALL OK` | 0 |
| Any failure (including state 503) | `DEGRADED: <names>` | 1 |

This script is read-only: it does not send auth headers, cookies, or tokens, and it does not modify Frank or production state.