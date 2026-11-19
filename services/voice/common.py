"""Shared bind helpers and swappable STT/TTS engines for local voice service."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Tuple

DEFAULT_STT_MODEL = "base.en"
DEFAULT_TTS_VOICE = "en_US-amy-medium"
MAX_TTS_CHARS = 1000
STT_PORT = 9000
TTS_PORT = 9001

ALLOWED_AUDIO_SUFFIXES = {".wav", ".ogg", ".m4a"}
ALLOWED_AUDIO_MIMES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/ogg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "application/ogg",
}


def resolve_bind() -> str:
    """127.0.0.1 by default; set VOICE_BIND to a Tailscale interface IP to serve the tailnet."""
    return (os.environ.get("VOICE_BIND") or "127.0.0.1").strip() or "127.0.0.1"


def piper_bin() -> str:
    explicit = os.environ.get("VOICE_PIPER_BIN", "").strip()
    if explicit:
        return explicit
    found = shutil.which("piper")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "piper.exe"
    if local.is_file():
        return str(local)
    return "piper"


def piper_model_path(voice: str) -> Path:
    override = os.environ.get("VOICE_TTS_MODEL_PATH", "").strip()
    if override:
        return Path(override)
    root = Path(os.environ.get("VOICE_MODEL_DIR", Path.home() / ".hydi" / "voice"))
    return root / f"{voice}.onnx"


class SttEngine:
    def __init__(self, model_name: str | None = None, loader: Callable[[str], object] | None = None):
        self.model_name = model_name or os.environ.get("VOICE_STT_MODEL", DEFAULT_STT_MODEL)
        self._loader = loader
        self._model = None

    def _whisper_model(self):
        if self._model is not None:
            return self._model
        if self._loader is not None:
            self._model = self._loader(self.model_name)
            return self._model
        from faster_whisper import WhisperModel  # noqa: WPS433 — optional at runtime

        self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
        return self._model

    def transcribe_file(self, audio_path: str) -> Tuple[str, int]:
        t0 = time.perf_counter()
        mock = os.environ.get("VOICE_STT_MOCK_TEXT")
        if mock is not None:
            text = mock
        else:
            model = self._whisper_model()
            segments, _info = model.transcribe(audio_path, beam_size=1, vad_filter=False)
            parts = [seg.text.strip() for seg in segments if seg.text and seg.text.strip()]
            text = " ".join(parts).strip()
        duration_ms = max(0, int((time.perf_counter() - t0) * 1000))
        return text, duration_ms


class TtsEngine:
    def __init__(self, voice: str | None = None, synthesize_fn: Callable[[str, Path], None] | None = None):
        self.voice = voice or os.environ.get("VOICE_TTS_VOICE", DEFAULT_TTS_VOICE)
        self._synthesize_fn = synthesize_fn

    def synthesize_wav(self, text: str) -> bytes:
        if self._synthesize_fn is not None:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                out = Path(tmp.name)
            try:
                self._synthesize_fn(text, out)
                return out.read_bytes()
            finally:
                out.unlink(missing_ok=True)

        mock = os.environ.get("VOICE_TTS_MOCK_WAV")
        if mock is not None:
            return mock.encode("latin-1") if mock.startswith("RIFF") else bytes.fromhex(mock)

        model = piper_model_path(self.voice)
        if not model.is_file():
            raise FileNotFoundError(f"Piper model not found: {model}")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            out = Path(tmp.name)
        try:
            cmd = [piper_bin(), "--model", str(model), "--output_file", str(out)]
            proc = subprocess.run(
                cmd,
                input=text.encode("utf-8"),
                capture_output=True,
                check=False,
                timeout=int(os.environ.get("VOICE_TTS_TIMEOUT", "60")),
            )
            if proc.returncode != 0:
                err = proc.stderr.decode("utf-8", errors="replace").strip()
                raise RuntimeError(err or f"piper exited {proc.returncode}")
            return out.read_bytes()
        finally:
            out.unlink(missing_ok=True)


_stt_singleton: SttEngine | None = None
_tts_singleton: TtsEngine | None = None


def get_stt_engine() -> SttEngine:
    global _stt_singleton
    if _stt_singleton is None:
        _stt_singleton = SttEngine()
    return _stt_singleton


def get_tts_engine() -> TtsEngine:
    global _tts_singleton
    if _tts_singleton is None:
        _tts_singleton = TtsEngine()
    return _tts_singleton


def set_stt_engine(engine: SttEngine | None) -> None:
    global _stt_singleton
    _stt_singleton = engine


def set_tts_engine(engine: TtsEngine | None) -> None:
    global _tts_singleton
    _tts_singleton = engine