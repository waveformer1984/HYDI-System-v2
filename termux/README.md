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

## ADB fixes — run once you have USB access to Frank

The phone's Android battery manager (the "phantom process killer") keeps
suspending Termux in the background, which kills Ollama/`launch-heidi-mobile.js`
mid-task. `termux-wake-lock` and pm2's `autorestart` only help once the app is
already exempted — they can't resurrect a process after Android kills the
whole Termux app. These need a real ADB session (ADB over USB doesn't work
from within Termux itself for this):

1. **Battery optimization whitelist for Termux** (confirmed fix, exact command):
   ```bash
   adb shell dumpsys deviceidle whitelist +com.termux
   # if Termux:Boot is installed as a separate package too:
   adb shell dumpsys deviceidle whitelist +com.termux.boot
   ```
   Verify with `adb shell dumpsys deviceidle whitelist | grep termux` — no
   output means it isn't whitelisted yet.

2. **Permanent phantom-process-killer fix** (Samsung Galaxy S10 FE, One UI /
   Android 12+). This is the actual AOSP "phantom process killer" — a
   system-level limit on child processes introduced in Android 12 that hits
   Termux hard because Termux/proot spawn many short-lived processes. Raise
   the cap so it effectively never triggers:
   ```bash
   adb shell "settings put global settings_enable_monitor_phantom_procs false"
   adb shell "device_config set_sync_disabled_for_tests persistent"
   adb shell "device_config put activity_manager max_phantom_processes 2147483647"
   ```
   Verify with:
   ```bash
   adb shell "device_config get activity_manager max_phantom_processes"
   ```
   This resets on some OTA updates, so re-check it after any system update.

   Separately, Samsung's own Device Care sits on top of this and isn't
   ADB-settable — do this once by hand on the phone: **Settings → Battery
   and device care → Battery → Background usage limits →** move Termux (and
   Termux:Boot) out of "Sleeping apps" / "Deep sleeping apps" and into the
   **never-sleeping** list.

3. **Thin-client mode verification** — once on the same network as Frank,
   confirm `FRANK_IP` (currently assumed `192.168.1.100`, unverified) and set
   it so the phone can point at Frank's Ollama instead of running inference
   on-device.
