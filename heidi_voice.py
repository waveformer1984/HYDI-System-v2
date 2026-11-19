#!/usr/bin/env python3
"""
Heidi voice — Termux push-to-talk (stdlib only).

Does not import or modify hydi.py / ~/hydi/heidi.py.

Frank path: microphone → http://$FRANK_IP:9000/stt → brief Heidi reply (Ollama
on Frank) → http://$FRANK_IP:9001/tts → termux-media-player.

Fallback when Frank voice is unreachable (probe ≤3s): termux-speech-to-text,
local llama.cpp :8080 reply, termux-tts-speak.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

VOICE_PROBE_TIMEOUT = 3
STT_TIMEOUT = 30
TTS_TIMEOUT = 15
RECORD_MS = 15000
MAX_TTS_CHARS = 1000
HEIDI_SYSTEM = (
    "You are Heidi on the owner's phone. Answer in one or two short sentences. "
    "Never approve, execute, charge, pay, or transfer anything. Voice is read-only."
)

LLAMA_URL = os.environ.get("HYDI_LLAMA_URL", "http://127.0.0.1:8080").rstrip("/")


def _load_thin_client_env(path=None):
    path = path or os.path.expanduser("~/.hydi/thin-client.env")
    try:
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key.startswith("export "):
                    key = key[len("export ") :].strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


def frank_host() -> str | None:
    _load_thin_client_env()
    raw = (os.environ.get("FRANK_IP") or os.environ.get("FRANK_HOSTS") or "").strip()
    if not raw:
        return None
    return raw.split(",")[0].strip() or None


def log(line: str) -> None:
    print(f"heidi_voice: {line}", file=sys.stderr)


def probe_frank_voice(host: str) -> bool:
    try:
        url = f"http://{host}:9000/health"
        with urlopen(url, timeout=VOICE_PROBE_TIMEOUT) as r:
            if r.status >= 500:
                return False
            body = json.loads(r.read().decode("utf-8"))
            return bool(body.get("ok"))
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return False


def _http_json(method: str, url: str, payload: dict | None, timeout: float) -> tuple[bool, dict | str]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
        try:
            return True, json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return True, raw
    except HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8"))
        except Exception:
            err = {"error": str(e)}
        return False, err
    except (URLError, TimeoutError, OSError) as e:
        return False, {"error": str(e)}


def post_stt(host: str, wav_path: Path) -> tuple[bool, str, str | None]:
    data = wav_path.read_bytes()
    boundary = f"----heidi-voice-{int(time.time())}"
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n".encode("utf-8"),
        data,
        f"\r\n--{boundary}--\r\n".encode("utf-8"),
    ]
    body = b"".join(parts)
    req = Request(
        f"http://{host}:9000/stt",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=STT_TIMEOUT) as r:
            parsed = json.loads(r.read().decode("utf-8"))
        if not parsed.get("ok"):
            return False, "", parsed.get("error") or "stt_failed"
        text = (parsed.get("text") or "").strip()
        return True, text, None
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
        return False, "", str(e)


def post_tts(host: str, text: str) -> tuple[bool, bytes | None, str | None]:
    trimmed = text.strip()[:MAX_TTS_CHARS]
    if not trimmed:
        return False, None, "empty_text"
    ok, body = _http_json("POST", f"http://{host}:9001/tts", {"text": trimmed}, TTS_TIMEOUT)
    if not ok:
        err = body.get("error") if isinstance(body, dict) else str(body)
        return False, None, err or "tts_failed"
    if isinstance(body, bytes) and body[:4] == b"RIFF":
        return True, body, None
    if isinstance(body, dict):
        return False, None, body.get("error") or "invalid_wav"
    return False, None, "invalid_wav"


def ollama_reply(host: str, user_text: str) -> str:
    model = os.environ.get("VOICE_OLLAMA_MODEL", "qwen2.5:3b")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": HEIDI_SYSTEM},
            {"role": "user", "content": user_text},
        ],
        "stream": False,
        "options": {"temperature": 0.5, "num_predict": 256},
    }
    ok, body = _http_json("POST", f"http://{host}:11434/api/chat", payload, 60)
    if not ok or not isinstance(body, dict):
        return "I could not reach Frank's model for an answer."
    msg = body.get("message") or {}
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, str) and content.strip():
        return content.strip()[:MAX_TTS_CHARS]
    return "I did not get a clear answer from the model."


def llama_local_reply(user_text: str) -> str:
    try:
        with urlopen(f"{LLAMA_URL}/v1/models", timeout=3) as r:
            models = json.loads(r.read()).get("data") or []
        model = models[0]["id"] if models else "llama.cpp"
    except Exception:
        return f"(offline) You said: {user_text[:200]}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": HEIDI_SYSTEM},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.5,
        "max_tokens": 256,
    }
    ok, body = _http_json("POST", f"{LLAMA_URL}/v1/chat/completions", payload, 90)
    if ok and isinstance(body, dict):
        try:
            text = body["choices"][0]["message"]["content"]
            if isinstance(text, str) and text.strip():
                return text.strip()[:MAX_TTS_CHARS]
        except (KeyError, IndexError, TypeError):
            pass
    return f"(local fallback) You said: {user_text[:200]}"


def record_audio(path: Path) -> bool:
    if not shutil.which("termux-microphone-record"):
        log("termux-microphone-record not found (install termux-api)")
        return False
    proc = subprocess.Popen(
        ["termux-microphone-record", "-f", str(path), "-l", str(RECORD_MS)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    def _stop_on_enter():
        try:
            input("Recording… press Enter to stop.\n")
        except EOFError:
            pass
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()

    threading.Thread(target=_stop_on_enter, daemon=True).start()
    try:
        proc.wait(timeout=RECORD_MS / 1000 + 5)
    except subprocess.TimeoutExpired:
        proc.kill()
    return path.is_file() and path.stat().st_size > 44


def termux_stt_fallback() -> tuple[bool, str]:
    if not shutil.which("termux-speech-to-text"):
        return False, ""
    try:
        out = subprocess.run(
            ["termux-speech-to-text", "-l", "en"],
            capture_output=True,
            text=True,
            timeout=RECORD_MS / 1000 + 5,
            check=False,
        )
        text = (out.stdout or "").strip()
        return bool(text), text
    except (subprocess.TimeoutExpired, OSError):
        return False, ""


def termux_tts_fallback(text: str) -> None:
    if not shutil.which("termux-tts-speak"):
        log("termux-tts-speak not found")
        print(text)
        return
    try:
        subprocess.run(
            ["termux-tts-speak", text[:MAX_TTS_CHARS]],
            timeout=30,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, OSError):
        print(text)


def play_wav(path: Path) -> None:
    player = shutil.which("termux-media-player") or shutil.which("mpv")
    if not player:
        log(f"no player; wav saved at {path}")
        return
    cmd = [player, str(path)] if player.endswith("mpv") else ["termux-media-player", "play", str(path)]
    try:
        subprocess.run(cmd, timeout=120, check=False)
    except (subprocess.TimeoutExpired, OSError):
        log("playback failed")


def run_frank_pipeline(host: str) -> int:
    fd, wav_name = tempfile.mkstemp(prefix="heidi-voice-", suffix=".wav")
    os.close(fd)
    wav = Path(wav_name)
    try:
        if not record_audio(wav):
            log("recording failed")
            return 1
        ok, transcript, err = post_stt(host, wav)
        if not ok or not transcript:
            log(f"stt failed: {err}")
            return 1
        log(f"heard: {transcript[:120]}")
        answer = ollama_reply(host, transcript)
        ok_tts, audio, terr = post_tts(host, answer)
        if not ok_tts or not audio:
            log(f"tts failed: {terr}")
            print(answer)
            return 1
        fd2, out_name = tempfile.mkstemp(prefix="heidi-tts-", suffix=".wav")
        os.close(fd2)
        out = Path(out_name)
        try:
            out.write_bytes(audio)
            print(answer)
            play_wav(out)
        finally:
            out.unlink(missing_ok=True)
        return 0
    finally:
        wav.unlink(missing_ok=True)


def run_fallback_pipeline() -> int:
    log("fallback: Frank voice unreachable — termux STT/TTS + local llama.cpp")
    ok, transcript = termux_stt_fallback()
    if not ok:
        log("fallback STT failed")
        return 1
    log(f"heard (fallback): {transcript[:120]}")
    answer = llama_local_reply(transcript)
    print(answer)
    termux_tts_fallback(answer)
    return 0


def main() -> int:
    host = frank_host()
    if host and probe_frank_voice(host):
        log(f"using Frank voice at {host}")
        return run_frank_pipeline(host)
    if host:
        log(f"Frank voice probe failed for {host} ({VOICE_PROBE_TIMEOUT}s)")
    else:
        log("FRANK_IP unset")
    return run_fallback_pipeline()


if __name__ == "__main__":
    raise SystemExit(main())