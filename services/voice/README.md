# HYDI local voice service (Frank Windows, $0)

Two small Flask processes: **STT :9000** (faster-whisper, CPU `int8`) and **TTS :9001** (Piper). No cloud APIs.

## Install (Frank)

```powershell
cd C:\Users\Owner\HYDI-System-v2
python -m venv .venv-voice
.\.venv-voice\Scripts\pip install -r services\voice\requirements.txt
```

### faster-whisper model

Default `VOICE_STT_MODEL=base.en` (downloaded automatically on first transcribe). Pin explicitly:

```powershell
$env:VOICE_STT_MODEL = "base.en"
```

### Piper binary + voice

1. Download [Piper](https://github.com/rhasspy/piper/releases) Windows build; extract `piper.exe`.
2. Set `VOICE_PIPER_BIN` to the full path, e.g. `C:\Tools\piper\piper.exe`.
3. Download voice ONNX + JSON (default `en_US-amy-medium`):

```powershell
New-Item -ItemType Directory -Force $env:USERPROFILE\.hydi\voice | Out-Null
# From rhasspy/piper voices repo — example URLs change with releases; use voice files matching en_US-amy-medium
$env:VOICE_MODEL_DIR = "$env:USERPROFILE\.hydi\voice"
$env:VOICE_TTS_VOICE = "en_US-amy-medium"
```

Place `en_US-amy-medium.onnx` (and `.onnx.json`) under `%USERPROFILE%\.hydi\voice\`, or set `VOICE_TTS_MODEL_PATH` to the `.onnx` file.

## Run

Loopback only (default):

```powershell
cd services\voice
python stt_server.py
# second terminal:
python tts_server.py
```

Tailnet (bind Tailscale interface IP — **not** `0.0.0.0`):

```powershell
$env:VOICE_BIND = "100.x.x.x"   # heidi-pc Tailscale address
```

## Smoke tests

```powershell
curl.exe http://127.0.0.1:9000/health
curl.exe http://127.0.0.1:9001/health
curl.exe -X POST -F "file=@sample.wav" http://127.0.0.1:9000/stt
curl.exe -X POST -H "Content-Type: application/json" -d "{\"text\":\"Hello\"}" http://127.0.0.1:9001/tts --output hello.wav
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `VOICE_STT_MODEL` | `base.en` | faster-whisper model id |
| `VOICE_TTS_VOICE` | `en_US-amy-medium` | Piper voice basename |
| `VOICE_PIPER_BIN` | `piper` on PATH | Windows path to `piper.exe` |
| `VOICE_MODEL_DIR` | `%USERPROFILE%\.hydi\voice` | Piper `.onnx` location |
| `VOICE_BIND` | `127.0.0.1` | Listen address (Tailscale IP when phone needs LAN) |
| `VOICE_STT_PORT` | `9000` | STT port |
| `VOICE_TTS_PORT` | `9001` | TTS port |