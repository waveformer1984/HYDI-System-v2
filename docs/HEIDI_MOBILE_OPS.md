# Heidi Mobile Ops — tailnet Lifeline runbook

When **heidi-web-standalone** on `:3000` is down, the phone PWA (`/heidi`) loses chat, Forge Board, ops commands, and approvals — but **Tailscale** may still work (often **HTTP 502** from `tailscale serve`). **Lifeline** is a separate loopback service on Frank (`127.0.0.1:3090`) exposed only on the tailnet for PM2 status and safe restarts.

## Frank one-time setup (Jordan at the desk)

1. From the HYDI repo on Frank, start Lifeline under PM2 (does **not** modify `ecosystem.config.js`):

   ```powershell
   pm2 start services/lifeline/lifeline.pm2.config.js
   pm2 save
   ```

2. Expose Lifeline on HTTPS **8443** to loopback **3090** (tailnet only — **never** `tailscale funnel`):

   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:3090
   tailscale serve status
   ```

3. Confirm from Frank: `curl -sS http://127.0.0.1:3090/health` → JSON with `"service":"lifeline"`.

4. Optional: set `LIFELINE_ALLOWED_LOGINS` (comma-separated Tailscale logins). Default allowlist is in `services/lifeline/server.js`.

## Security model (Lifeline)

- Binds **127.0.0.1:3090** only; not reachable from LAN/WAN without `tailscale serve`.
- All routes except `GET /health` require header **`Tailscale-User-Login`** on the allowlist.
- Restarts: POST `/lifeline/restart/:app` with **`X-Lifeline: 1`**, app in allowlist only (`heidi-web-standalone`, `heidi-core`, `ursula-local`).
- Fixed PM2 argv (`cmd.exe /c pm2 …` on Windows); rate limits persisted in `.runtime/lifeline-state.json`; audit in `logs/lifeline-audit.log`.

## Optional: Windows OpenSSH (last resort from Termux)

If the phone needs a shell on Frank:

1. Install **OpenSSH Server** on Frank (Settings → Optional features).
2. Firewall rule: allow TCP 22 **only on the Tailscale interface** (not public profiles).
3. From Termux: `ssh Owner@heidi-pc` (MagicDNS).

Use only when Lifeline is insufficient; prefer Lifeline restarts over ad-hoc PM2 on the phone.

## For Devin on the deploy branch (do not merge from this PR)

When touching Frank’s main `ecosystem.config.js`, set for **heidi-web-standalone**:

- `max_restarts: 1000`
- `exp_backoff_restart_delay: 2000`

So PM2 keeps trying after crashes (today’s incident: restarts stopped at ~09:40).

## Phone playbook — Heidi won’t answer

1. On Termux: `sh scripts/phone/heidi-check.sh` (or copy from repo).
2. Read **VERDICT**:
   - `PHONE_OFF_TAILNET` → turn on Tailscale on the phone.
   - `WEB_DOWN_LIFELINE_UP` → open Lifeline URL, tap **Restart** on `heidi-web-standalone`, wait ~20s, re-run the script.
   - `ALL_DOWN` → Frank asleep, offline, or `tailscale serve` missing for :3000 and :8443.
   - `OK` / `DEGRADED` → partial issues; use Status tab in `/heidi` for detail.
3. In the PWA: after two consecutive 502-class chat failures, tap **Open Lifeline** on the chat card.
4. Re-check with `heidi-check.sh` until `VERDICT: OK`.

## 5-step phone test (after deploy)

1. Tailscale on; open `https://heidi-pc.tailc50af2.ts.net/heidi` — chat loads.
2. Run `heidi-check.sh` — `VERDICT: OK` when healthy.
3. Stop `heidi-web-standalone` on Frank (test only) — script shows `WEB_DOWN_LIFELINE_UP` or degraded health.
4. Open `https://heidi-pc.tailc50af2.ts.net:8443/lifeline/` — status cards refresh; restart web app with confirm.
5. Chat works again; script returns `ALL OK`.