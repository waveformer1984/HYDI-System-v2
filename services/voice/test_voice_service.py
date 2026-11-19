"""Unit tests for local voice microservices (mocked engines, no GPU/models)."""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest

VOICE_DIR = Path(__file__).resolve().parent
if str(VOICE_DIR) not in sys.path:
    sys.path.insert(0, str(VOICE_DIR))

import common
import stt_server
import tts_server

stt_app = stt_server.app
tts_app = tts_server.app


@pytest.fixture(autouse=True)
def reset_engines():
    common.set_stt_engine(None)
    common.set_tts_engine(None)
    yield
    common.set_stt_engine(None)
    common.set_tts_engine(None)


def test_stt_health():
    client = stt_app.test_client()
    res = client.get("/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["service"] == "stt"
    assert body["port"] == 9000


def test_tts_health():
    client = tts_app.test_client()
    res = client.get("/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["service"] == "tts"
    assert body["port"] == 9001


def test_stt_wav_mock_engine():
    def fake_loader(_name):
        return object()

    engine = common.SttEngine(loader=fake_loader)

    def fake_transcribe(_path):
        return "hello hydi", 12

    engine.transcribe_file = fake_transcribe  # type: ignore[method-assign]
    common.set_stt_engine(engine)

    client = stt_app.test_client()
    data = {"file": (io.BytesIO(b"RIFF"), "clip.wav")}
    res = client.post("/stt", data=data, content_type="multipart/form-data")
    assert res.status_code == 200
    body = res.get_json()
    assert body == {"ok": True, "text": "hello hydi", "duration_ms": body["duration_ms"]}
    assert body["duration_ms"] >= 0
    assert body["text"] == "hello hydi"


def test_stt_rejects_unknown_type():
    client = stt_app.test_client()
    data = {"file": (io.BytesIO(b"x"), "clip.mp3")}
    res = client.post("/stt", data=data, content_type="multipart/form-data")
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_tts_wav_mock_engine():
    riff = b"RIFF\x00\x00\x00\x00WAVEfmt "

    def fake_synth(text: str, out: Path) -> None:
        out.write_bytes(riff)

    engine = common.TtsEngine(synthesize_fn=fake_synth)
    common.set_tts_engine(engine)

    client = tts_app.test_client()
    res = client.post("/tts", json={"text": "Status nominal"})
    assert res.status_code == 200
    assert res.mimetype == "audio/wav"
    assert res.data.startswith(b"RIFF")


def test_tts_rejects_long_text():
    client = tts_app.test_client()
    res = client.post("/tts", json={"text": "x" * 1001})
    assert res.status_code == 400
    body = res.get_json()
    assert body["ok"] is False
    assert "1000" in body["error"]


def test_tts_engine_error_returns_json():
    class Boom(Exception):
        pass

    def explode(_text, _out):
        raise Boom("nope")

    common.set_tts_engine(common.TtsEngine(synthesize_fn=explode))
    client = tts_app.test_client()
    res = client.post("/tts", json={"text": "hi"})
    assert res.status_code == 500
    assert res.get_json()["error"] == "Boom"


def test_resolve_bind_defaults_loopback(monkeypatch):
    monkeypatch.delenv("VOICE_BIND", raising=False)
    assert common.resolve_bind() == "127.0.0.1"
    monkeypatch.setenv("VOICE_BIND", "100.64.0.2")
    assert common.resolve_bind() == "100.64.0.2"