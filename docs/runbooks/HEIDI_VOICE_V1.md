# Heidi voice V1 — Frank + phone ($0, local)

Local faster-whisper (**:9000**) and Piper (**:9001**) on Frank; Termux push-to-talk via `heidi_voice.py`. Voice never approves or executes.

## 1. Frank — Python venv

```powershell
cd C:\Users\Owner\HYDI-System-v2\services\voice
python -m venv .venv-voice
.\.venv-voice\Scripts\pip install -r requirements.txt
```

## 2. Frank — Whisper + Piper models

- STT: `VOICE_STT_MODEL=base.en` (auto-download on first use).
- Piper: install `piper.exe`, set `VOICE_PIPER_BIN`, place `en_US-amy-medium.onnx` under `%USERPROFILE%\.hydi\voice\`.

## 3. Frank — start services (loopback)

```powershell
cd C:\Users\Owner\HYDI-System-v2\services\voice
python stt_server.py
# new terminal:
python tts_server.py
```

## 4. Frank — Tailnet bind (phone access)

```powershell
$env:VOICE_BIND = "<Tailscale IPv4 of heidi-pc>"
# restart both servers with VOICE_BIND set
```

## 5. Windows Firewall (Tailscale interface only)

Allow inbound TCP **9000** and **9001** on the **Tailscale** profile only (not Public). Example (adjust interface name):

```powershell
New-NetFirewallRule -DisplayName "Heidi STT tailnet" -Direction Inbound -LocalPort 9000 -Protocol TCP -InterfaceAlias "Tailscale" -Action Allow
New-NetFirewallRule -DisplayName "Heidi TTS tailnet" -Direction Inbound -LocalPort 9001 -Protocol TCP -InterfaceAlias "Tailscale" -Action Allow
```

## 6. Frank — curl smoke tests

```powershell
curl.exe http://127.0.0.1:9000/health
curl.exe http://127.0.0.1:9001/health
curl.exe -X POST -F "file=@sample.wav" http://127.0.0.1:9000/stt
curl.exe -X POST -H "Content-Type: application/json" -d "{\"text\":\"Hello\"}" http://127.0.0.1:9001/tts --output hello.wav
```

## 7. Phone — Termux packages

```bash
pkg install termux-api
# Grant microphone in Android settings for Termux:API
```

## 8. Phone — `FRANK_IP`

```bash
export FRANK_IP=heidi-pc.tailc50af2.ts.net
# or persist in ~/.hydi/thin-client.env
```

## 9. Phone — sync `heidi_voice.py`

Copy from repo root to phone (git pull or scp). Do **not** overwrite `~/hydi/heidi.py`.

## 10. Phone — round trip (Frank)

```bash
python3 heidi_voice.py
# Speak after prompt; Enter stops recording early
```

## 11. Phone — fallback test

Stop Frank voice servers or unset reachable `FRANK_IP`; run again — log shows `fallback:` and uses termux STT/TTS + `127.0.0.1:8080` llama.cpp when up.

## 12. Hygiene

- Temp `.wav` files removed after play (Frank path).
- No `HEIDI_ALLOW_EXEC`; V3 `VoiceCommandRouter` blocks spoken approve/execute phrases.

**Branch:** `heidi-voice-v1` → open PR to `clean-main` when ready (do not merge voice with exec enabled).