# Self-Healing & Recovery Runbook — HYDI Mobile Stack

Last updated: 2026-06-13

---

## Quick Diagnostic

Run this in PowerShell to check all services at once:

```powershell
# Check what's listening on key ports
@(3006, 5050, 11434, 4000) | ForEach-Object {
    $conn = Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue
    if ($conn) { Write-Host "PORT $_`: LISTENING (PID $($conn.OwningProcess))" -ForegroundColor Green }
    else        { Write-Host "PORT $_`: not listening" -ForegroundColor Red }
}
```

From phone/Termux:
```bash
curl http://192.168.86.82:5050/health && echo "bridge OK"
curl http://192.168.86.82:11434/api/tags && echo "ollama OK"
curl http://192.168.86.82:3006/api/health && echo "heidi OK"
```

---

## Symptom: Port already in use (EADDRINUSE :3006)

**Cause:** Previous Heidi instance still running.

**Fix (PowerShell):**
```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3006).OwningProcess -Force
node launch-heidi-mobile.js
```

**Fix (Termux):**
```bash
pkill -f launch-heidi-mobile.js
sleep 1
node launch-heidi-mobile.js
```

---

## Symptom: Ollama not found / "injected env (0)"

**Cause A:** Ollama not running.
```powershell
$env:OLLAMA_HOST = "0.0.0.0"
ollama serve
```

**Cause B:** Ollama running but only on localhost (phone can't reach it).
```powershell
# Stop current Ollama, restart with network binding
taskkill /F /IM ollama.exe
$env:OLLAMA_HOST = "0.0.0.0"
ollama serve
```

**Permanent fix** — set system environment variable so it persists across reboots:
```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0", "Machine")
```

---

## Symptom: .env shows "injected env (0)"

**Cause:** File was written by PowerShell `echo` (UTF-16 LE encoding) — dotenvx can't parse it.

**Fix:**
```powershell
cd C:\Users\Owner\HYDI-System-v2
Set-Content .env "URSULA_URL=http://192.168.86.82:5050`nOLLAMA_URL=http://192.168.86.82:11434`nPORT=3006"
```

**Verify encoding:**
```powershell
Get-Content .env -Encoding Byte -TotalCount 4 | Format-Hex
# First bytes should be: 55 52 53 4C (not FF FE = UTF-16 BOM)
```

**Nuclear fix (always works):**
```powershell
[System.IO.File]::WriteAllText(
    (Join-Path $PWD ".env"),
    "URSULA_URL=http://192.168.86.82:5050`nOLLAMA_URL=http://192.168.86.82:11434`nPORT=3006`n",
    [System.Text.UTF8Encoding]::new($false)
)
```

---

## Symptom: Bridge not reachable from phone

**Cause A:** Bridge not running.
```powershell
cd C:\ProtoForge_Ecosystem
python heidi-bridge.py
```

**Cause B:** Windows Firewall blocking port 5050.
```powershell
New-NetFirewallRule -DisplayName "Heidi Bridge LAN" -Direction Inbound -Protocol TCP -LocalPort 5050 -Action Allow -Profile Private
```

**Cause C:** PC IP changed (DHCP reassigned).
```powershell
# Find current IP
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notmatch 'Loopback'}).IPAddress
```
Then update `.env` on phone with the new IP.

---

## Symptom: Ollama firewall blocked from phone

```powershell
New-NetFirewallRule -DisplayName "Ollama LAN" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow -Profile Private
```

---

## Symptom: "Cannot find module launch-heidi-mobile.js"

**Cause:** Running `node` from wrong directory.

**Fix:**
```powershell
cd C:\Users\Owner\HYDI-System-v2
node launch-heidi-mobile.js
```

---

## Symptom: Repo not on Termux phone

```bash
cd ~
git clone https://github.com/waveformer1984/HYDI-System-v2.git --branch claude/local-mobile-chat-app-c3UBW --depth 1
cd ~/HYDI-System-v2
npm install
printf 'URSULA_URL=http://192.168.86.82:5050\nOLLAMA_URL=http://192.168.86.82:11434\nPORT=3006\n' > .env
node launch-heidi-mobile.js
```

---

## Symptom: Web push subscriptions lost after restart

**Cause:** Subscriptions stored in-memory only — cleared on server restart.

**Fix:** Users re-tap the bell icon in Heidi to re-subscribe. No data loss — just re-registration.

**Long-term fix:** Persist to Supabase `heidi_push_subscriptions` table (future work).

---

## Symptom: Rezonate score returns error

**Cause:** Rezonette repo not cloned.

**Fix:**
```powershell
cd C:\ProtoForge_Ecosystem
git clone https://github.com/waveformer1984/rezonette.git
```

---

## Full Stack Restart (PC)

Open 3 PowerShell windows:

**Window 1 — Ollama:**
```powershell
$env:OLLAMA_HOST = "0.0.0.0"
ollama serve
```

**Window 2 — Bridge:**
```powershell
cd C:\ProtoForge_Ecosystem
python heidi-bridge.py
```

**Window 3 — Heidi:**
```powershell
cd C:\Users\Owner\HYDI-System-v2
node launch-heidi-mobile.js
```

Expected startup output:
```
✅ Ollama: tinyllama:latest, qwen2.5-coder:1.5b, llama3.2:latest
Ursula (Flask): connected at http://192.168.86.82:5050 — status: healthy
Revenue tools: active (Supabase connected)   # if Supabase keys set
Stripe checkout: ready                        # if Stripe key set
Push alerts: ready | Backend observer: active
```

---

## Auto-start Setup (one-time, run as Admin)

```powershell
cd C:\Users\Owner\HYDI-System-v2
.\heidi-autostart.ps1
```

This registers the bridge as a Windows Task Scheduler job that starts at logon and auto-restarts on failure.

For Ollama persistence, also set the system env var:
```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0", "Machine")
```

---

## Remote Access (away from home WiFi)

```powershell
cd C:\Users\Owner\HYDI-System-v2
.\heidi-tunnel.ps1
```

This starts a Cloudflare Quick Tunnel — outputs a public `trycloudflare.com` URL. Update phone `.env`:
```
URSULA_URL=https://xxxx.trycloudflare.com
OLLAMA_URL=https://xxxx.trycloudflare.com/ollama   # if proxied
```

---

## Starting Everything at Once

Instead of 3 separate terminal windows for Heidi:

```powershell
cd C:\Users\Owner\HYDI-System-v2
node start-all.js
```

This starts both the Heidi chat server AND the WorkerOrchestrator in one process.
To skip workers (lighter startup):

```powershell
node start-all.js --no-workers
# or
npm run start:no-workers
```

---

## Symptom: Semantic memory not working ("no relevant memories recalled")

**Cause A:** Embedding model not available in Ollama.

Semantic memory uses `nomic-embed-text` or `mxbai-embed-large` first. If neither is installed, it falls back to `tinyllama` (less accurate).

```powershell
ollama pull nomic-embed-text
```

**Cause B:** Memory file corrupt.

```powershell
cd C:\Users\Owner\HYDI-System-v2
del .heidi-memory.json
```

Server recreates it fresh on next store operation.

---

## Symptom: `/api/plan` returns 503

Ollama is not running or model is not loaded. Start Ollama and verify:

```powershell
curl http://localhost:11434/api/tags
```

---

## Symptom: Workers fail to start (`Cannot find module '@supabase/supabase-js'`)

Run `npm install` in the HYDI-System-v2 directory:

```powershell
cd C:\Users\Owner\HYDI-System-v2
npm install --legacy-peer-deps
```
