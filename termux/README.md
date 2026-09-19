# HYDI Chat on Termux — fully phone-local

Run the HYDI mobile chat entirely from your Android phone. No Vercel, no
GitHub Pages — a zero-dependency Node server that serves the chat UI and
answers the chat API by talking straight to Supabase.

```
Phone browser ──► hydi-chat-server.js (Termux, :8787) ──► Supabase REST
```

## Quick start

```bash
# In Termux, from the repo (or just copy the termux/ folder to your phone):
cd termux
bash setup-termux-chat.sh      # installs Node.js, creates .env.hydi
nano .env.hydi                 # paste SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
source .env.hydi
node hydi-chat-server.js
```

Open **http://localhost:8787** in your phone's browser. In the chat's ⚙️
settings leave the API URL **blank** (same origin) — no secret is needed
unless you set `HYDI_SERVICE_SECRET`.

## What works on this node

| System | Live data |
|--------|-----------|
| ursula | `status` — system_dashboard health, trend, queue |
| cascade | `status`, `quarantine` — event queue counts |
| kilo | `hypothesis`, `validate` — health trend RPCs |
| protoforge | status + `govern` — escalation state |
| hyve | lead/opportunity counts |
| infrastructure | `health`, `resources`, `alerts` |
| rezonate | `revenue` — 24h ledger for the rezonate stream |
| heidi | acknowledges tasks (full orchestration stays on the main deployment) |

Without Supabase credentials the server still runs in offline mode and says
so in each reply — useful for checking the UI works.

## Keep it running

```bash
nohup node hydi-chat-server.js > hydi-chat.log 2>&1 &        # simple
# or
npm i -g pm2 && pm2 start hydi-chat-server.js --name hydi-chat && pm2 save
```

Termux tip: run `termux-wake-lock` so Android doesn't kill the process, and
install the Termux:Boot app to start it automatically after reboot.

## Security notes

- The server binds to all interfaces so you can reach it from other devices
  on your LAN. If you do that, set `HYDI_SERVICE_SECRET` in `.env.hydi` — the
  chat UI will then sign every request with the same HMAC scheme production
  uses. For purely on-phone use (localhost), no secret is fine.
- `.env.hydi` holds your service-role key. It stays on the phone; never
  commit it. `chmod 600 .env.hydi` if you're cautious.

## Optional: full repo clone + manual Vercel deploy

The quick-start above is the default, local-first path — no Vercel needed.
If you specifically want to build/ship a Vercel deploy by hand from your
phone (not auto-deploy-on-push, which stays disabled per CLAUDE.md's
Local-First Architecture section), use:

```bash
bash setup-termux-vercel.sh    # clones the full repo, npm install, vercel link
cd ~/HYDI-System-v2
vercel --prod                  # run this whenever you actually want to deploy
```

The script is safe to re-run — it `git pull`s instead of failing on an
already-cloned repo, and skips `vercel login`/`link` once already done.

### Troubleshooting: "destination path ... already exists"

If you typed the setup commands in one at a time instead of running
`setup-termux-vercel.sh` as a script, a bare `git clone` fails with:

```
fatal: destination path 'HYDI-System-v2' already exists and is not an empty directory.
```

That just means `~/HYDI-System-v2` is already cloned from an earlier run —
don't re-clone, pull instead:

```bash
cd ~/HYDI-System-v2
git pull --ff-only
```

Re-running `setup-termux-vercel.sh` itself avoids this entirely — it already
checks for an existing clone and pulls instead of cloning.

## Verifying a host before exposing it: `hydi-production-connect.sh`

Before pointing anything external (a Vercel-hosted portal, a phone, another
machine) at a HYDI host, run the connectivity checker from the repo root on
the machine that runs HYDI:

```bash
export HYDI_SERVICE_SECRET=...            # never pass it as an argument
bash termux/hydi-production-connect.sh    # local only
```

Once a tunnel is up (`tailscale funnel 3000`, or
`cloudflared tunnel --url http://127.0.0.1:3000`), re-run with the public
hostname so the same probes run from outside, and add the portal when it is
deployed:

```bash
bash termux/hydi-production-connect.sh \
  --public-url https://<host>.<tailnet>.ts.net \
  --heidi-url  https://<portal-host>
```

It starts nothing and changes nothing — it probes and reports, exiting
non-zero if the host is not safe to expose. `HYDI_SERVICE_SECRET` is read
from the environment only; tokens reach curl through a `0600` config file
that is deleted on exit, so neither the secret nor a signed token ever
appears in `ps`, stdout, or shell history. The only secret facts it prints
are SET/UNSET and byte length.

### Which chat endpoint to integrate against

This trips people up, so the checker tests both:

| Path | Handler | Auth | Body |
|------|---------|------|------|
| `POST /api/chat/route` | `api/chat/route.js` | **HMAC-gated** (`x-hydi-service-token`) | `{ message, system }` |
| `POST /api/chat` | `pages/api/chat.ts` | **none** | `{ message, session_id, user_id }` → SSE |

**A remote client must integrate against `/api/chat/route`.** `/api/chat` is
Heidi's own single-agent streaming endpoint and performs no service-token
check at all, so probing *it* to confirm authentication always "succeeds"
regardless of the token — a false pass. The in-repo remote clients
(`docs/index.html`, `public/hydi-chat.html`) already target `/api/chat/route`
for this reason.

The corollary matters more: because `/api/chat` is ungated, tunnelling port
3000 publishes Heidi's orchestrator to the open internet. The checker reports
this as a warning locally and as a **failure** when `--public-url` is given.
Gate the path, block it at the tunnel, or keep the funnel down until it is
resolved.
