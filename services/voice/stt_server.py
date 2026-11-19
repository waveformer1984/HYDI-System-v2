"""Local STT microservice — POST /stt on port 9000 (Frank, CPU faster-whisper)."""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

from flask import Flask, jsonify, request

from common import (
    ALLOWED_AUDIO_MIMES,
    ALLOWED_AUDIO_SUFFIXES,
    STT_PORT,
    get_stt_engine,
    resolve_bind,
)

app = Flask(__name__)


def _suffix_from_request(filename: str | None, content_type: str | None) -> str | None:
    if filename:
        suf = Path(filename).suffix.lower()
        if suf in ALLOWED_AUDIO_SUFFIXES:
            return suf
    if content_type:
        ct = content_type.split(";")[0].strip().lower()
        if ct in ALLOWED_AUDIO_MIMES:
            mapping = {
                "audio/wav": ".wav",
                "audio/x-wav": ".wav",
                "audio/wave": ".wav",
                "audio/ogg": ".ogg",
                "application/ogg": ".ogg",
                "audio/mp4": ".m4a",
                "audio/m4a": ".m4a",
                "audio/x-m4a": ".m4a",
            }
            return mapping.get(ct)
    return None


def _save_upload() -> tuple[str | None, str | None]:
    content_type = (request.content_type or "").lower()
    if request.files:
        f = request.files.get("file") or request.files.get("audio") or next(iter(request.files.values()), None)
        if f:
            suf = _suffix_from_request(f.filename, f.content_type or content_type)
            if not suf:
                return None, "unsupported audio type (use wav, ogg, or m4a)"
            data = f.read()
            if not data:
                return None, "empty audio body"
            fd, path = tempfile.mkstemp(suffix=suf, prefix="voice-stt-")
            os.close(fd)
            Path(path).write_bytes(data)
            return path, None

    raw = request.get_data(cache=False)
    if not raw:
        return None, "no audio uploaded"
    suf = _suffix_from_request(None, content_type if content_type else "audio/wav")
    if not suf:
        return None, "unsupported Content-Type for raw body"
    fd, path = tempfile.mkstemp(suffix=suf, prefix="voice-stt-")
    os.close(fd)
    Path(path).write_bytes(raw)
    return path, None


@app.get("/health")
def health():
    engine = get_stt_engine()
    return jsonify(
        {
            "ok": True,
            "service": "stt",
            "model": engine.model_name,
            "bind": resolve_bind(),
            "port": STT_PORT,
        }
    )


@app.post("/stt")
def stt():
    started = time.perf_counter()
    path, err = _save_upload()
    if err:
        return jsonify(ok=False, error=err), 400
    assert path is not None
    try:
        text, engine_ms = get_stt_engine().transcribe_file(path)
        duration_ms = max(engine_ms, int((time.perf_counter() - started) * 1000))
        return jsonify(ok=True, text=text, duration_ms=duration_ms)
    except Exception as exc:  # noqa: BLE001 — return structured error to client
        return jsonify(ok=False, error=type(exc).__name__), 500
    finally:
        Path(path).unlink(missing_ok=True)


def main():
    host = resolve_bind()
    port = int(os.environ.get("VOICE_STT_PORT", STT_PORT))
    app.run(host=host, port=port, threaded=True)


if __name__ == "__main__":
    main()