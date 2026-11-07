# Phone phantom UI killer

Use when Termux/HYDI shows a stale “connected” UI but Frank is down.

## Symptoms

- PWA green while `curl` to `HYDI_API_URL/api/health` fails
- Duplicate `hydi` runit services after restore
- ADB phantom display (developer overlay)

## Termux (safe)

```bash
sv down hydi 2>/dev/null || true
sv down hydi-daemon 2>/dev/null || true
pkill -f hydi-chat-server || true
bash scripts/phone/health-probe.sh
```

## Human-action verifier

Resolver `phone-phantom-off` in `lib/human-actions/verifiers.js` — run from Frank when ADB available:

```powershell
# From human-actions queue when flagged
```

## Prevention

- Single `HYDI_API_URL` in `docs/PHONE_ENV_URLS.md`
- Network-first SW policy (`fix/hydi-sw-network-first` on clean-main)
- Do not cache `/api/mobile-status` as immutable
