# MakeReady Crew — Jenny tablet beta (tailnet only)

**Route:** `https://heidi-pc.tailc50af2.ts.net/makeready-crew` (not on the public ingress allowlist).

## Prerequisites (Frank)

1. Migration `20261120210000_makeready_crew.sql` applied to local Supabase.
2. Onboard Jenny’s company config (owner-supplied rates only):

   ```bash
   node scripts/makeready-onboard.js jenny-makeready
   ```

   (Same interactive onboard as MakeReady Bot — owner enters rates; see `docs/runbooks/MAKEREADY_BOT.md`.)

3. Set on **heidi-pc** `.env.local` (never commit):

   | Variable | Purpose |
   |----------|---------|
   | `MAKEREADY_CREW_COMPANY_SLUG` | Same slug as `config/makeready/<slug>.json` |
   | `MAKEREADY_CREW_PIN` | Tablet sign-in PIN |
   | `MAKEREADY_CREW_SESSION_SECRET` | Session HMAC (`openssl rand -base64 32`) |

4. `pm2 restart heidi-web-standalone` (or wait for deploy) after env change.

## Install on the tablet

1. Install **Tailscale** on the tablet; sign in to the same tailnet as `heidi-pc`.
2. In Chrome (or Edge), open  
   `https://heidi-pc.tailc50af2.ts.net/makeready-crew`
3. Sign in with the **owner PIN**.
4. **Add to Home Screen** / Install app (PWA manifest via `/api/makeready-crew/manifest`).

## Offline behavior

- Banner shows **Offline** when the network drops.
- Job actions queue in browser storage and sync via `/api/makeready-crew/sync` when online.
- Failed server responses are shown — the app does not pretend success.

## Operational notes

- Jobs are rows in `makeready_requests` for Jenny’s `company_slug`.
- Public builder intake stays on `/makeready-bot`; crew app is PIN-gated only.
- No SMS, no paid APIs in this beta.

## Verify (Frank, read-only)

```powershell
curl.exe -s -o NUL -w "%{http_code}" https://heidi-pc.tailc50af2.ts.net/makeready-crew
# Expect 200 on tailnet; public tunnel should 404 for non-operator paths
```