#!/usr/bin/env python3
"""heidi_voice.py — Frank vs fallback routing (mocked, no Termux)."""

import json
import os
import sys
import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import heidi_voice  # noqa: E402


class FakeResp:
    def __init__(self, body: bytes, status=200):
        self._body = body
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class HeidiVoiceTest(unittest.TestCase):
    def test_probe_true_on_ok_health(self):
        with mock.patch.object(
            heidi_voice,
            "urlopen",
            return_value=FakeResp(json.dumps({"ok": True, "service": "stt"}).encode()),
        ):
            self.assertTrue(heidi_voice.probe_frank_voice("10.0.0.1"))

    def test_probe_false_on_timeout(self):
        with mock.patch.object(heidi_voice, "urlopen", side_effect=TimeoutError()):
            self.assertFalse(heidi_voice.probe_frank_voice("10.0.0.1"))

    def test_post_stt_parses_text(self):
        wav = Path(ROOT) / "tests" / "fixtures" / "voice-empty.wav"
        wav.parent.mkdir(parents=True, exist_ok=True)
        wav.write_bytes(b"RIFF" + b"\x00" * 40)

        def fake_urlopen(req, timeout=None):
            self.assertIn(":9000/stt", req.full_url)
            return FakeResp(json.dumps({"ok": True, "text": "hello", "duration_ms": 12}).encode())

        with mock.patch.object(heidi_voice, "urlopen", side_effect=fake_urlopen):
            ok, text, err = heidi_voice.post_stt("frank.local", wav)
        wav.unlink(missing_ok=True)
        self.assertTrue(ok)
        self.assertEqual(text, "hello")
        self.assertIsNone(err)

    def test_fallback_when_probe_fails(self):
        with mock.patch.object(heidi_voice, "frank_host", return_value="frank"):
            with mock.patch.object(heidi_voice, "probe_frank_voice", return_value=False):
                with mock.patch.object(
                    heidi_voice,
                    "run_fallback_pipeline",
                    return_value=0,
                ) as fb:
                    rc = heidi_voice.main()
        self.assertEqual(rc, 0)
        fb.assert_called_once()

    def test_frank_path_when_probe_ok(self):
        with mock.patch.object(heidi_voice, "frank_host", return_value="frank"):
            with mock.patch.object(heidi_voice, "probe_frank_voice", return_value=True):
                with mock.patch.object(heidi_voice, "run_frank_pipeline", return_value=0) as fp:
                    rc = heidi_voice.main()
        self.assertEqual(rc, 0)
        fp.assert_called_once_with("frank")

    def test_does_not_import_hydi(self):
        self.assertNotIn("hydi", sys.modules)


if __name__ == "__main__":
    unittest.main(verbosity=2)