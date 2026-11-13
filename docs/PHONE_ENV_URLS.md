# Phone environment URLs

Set these in Termux `~/.hydi/env` or the PWA settings panel (names only in repo; values on device).

| Variable | Purpose | Example (tailnet) |
|----------|---------|-------------------|
| `HYDI_API_URL` | BFF / Next base | `https://heidi-pc.<tailnet>/` |
| `HEIDI_CORE_URL` | Direct heidi-core (debug) | `http://100.x.x.x:3459` |
| `HEIDI_MOBILE_PORT` | Mobile chat | `3006` |
| `HYDI_SERVICE_SECRET` | HMAC service token | *(set on phone — never commit)* |
| `HEIDI_MOBILE_TOKEN` | Device login | *(from `/api/pair` on Frank)* |
| `HYDI_PHONE_READ_TOKEN` | Frank observation read | *(optional)* |

## Reconcile with `config/ports.json`

| Service | Port |
|---------|------|
| heidi-web | 3000 |
| heidi-mobile-chat | 3006 |
| heidi-core | 3459 |
| ursula-local | 3100 |

After Frank port changes: `node scripts/check-port-registry.js` then update phone env.

## Probes

```bash
bash scripts/phone/health-probe.sh
```
