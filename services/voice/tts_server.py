"""Local TTS microservice — POST /tts on port 9001 (Frank, Piper)."""

from __future__ import annotations

import os

from flask import Flask, Response, jsonify, request

from common import MAX_TTS_CHARS, TTS_PORT, get_tts_engine, resolve_bind

app = Flask(__name__)


def _extract_text() -> tuple[str | None, str | None]:
    if request.is_json:
        body = request.get_json(silent=True) or {}
        text = body.get("text")
    else:
        text = request.form.get("text")
    if text is None:
        return None, "missing text"
    if not isinstance(text, str):
        return None, "text must be a string"
    text = text.strip()
    if not text:
        return None, "empty text"
    if len(text) > MAX_TTS_CHARS:
        return None, f"text exceeds {MAX_TTS_CHARS} characters"
    return text, None


@app.get("/health")
def health():
    engine = get_tts_engine()
    return jsonify(
        {
            "ok": True,
            "service": "tts",
            "voice": engine.voice,
            "bind": resolve_bind(),
            "port": TTS_PORT,
        }
    )


@app.post("/tts")
def tts():
    text, err = _extract_text()
    if err:
        return jsonify(ok=False, error=err), 400
    assert text is not None
    try:
        wav = get_tts_engine().synthesize_wav(text)
        if not wav.startswith(b"RIFF"):
            return jsonify(ok=False, error="invalid wav from engine"), 500
        return Response(wav, mimetype="audio/wav")
    except Exception as exc:  # noqa: BLE001
        return jsonify(ok=False, error=type(exc).__name__), 500


def main():
    host = resolve_bind()
    port = int(os.environ.get("VOICE_TTS_PORT", TTS_PORT))
    app.run(host=host, port=port, threaded=True)


if __name__ == "__main__":
    main()