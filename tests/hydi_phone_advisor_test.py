#!/usr/bin/env python3
"""Phone advisor: Frank probe/generate budgets, fallback, fail-closed BLOCK."""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ["FRANK_IP"] = "10.20.30.40"
os.environ.pop("FRANK_HOSTS", None)

import hydi  # noqa: E402


class Resp:
    def __init__(self, body, status=200):
        self._body = body
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fail(msg):
    raise SystemExit(msg)


def reset_events():
    hydi.PF["events"] = []


def test_frank_ok():
    reset_events()
    calls = []

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        calls.append((url, timeout))
        if ":11434/api/tags" in url:
            if timeout != hydi.FRANK_OLLAMA_TAGS_TIMEOUT:
                fail(f"tags timeout expected {hydi.FRANK_OLLAMA_TAGS_TIMEOUT}, got {timeout}")
            return Resp(b'{"models":[]}')
        if ":11434/api/generate" in url:
            if timeout != hydi.FRANK_OLLAMA_GENERATE_TIMEOUT:
                fail(f"generate timeout expected {hydi.FRANK_OLLAMA_GENERATE_TIMEOUT}, got {timeout}")
            body = json.dumps({"verdict": "REVIEW", "confidence": 0.9, "reason": "needs human"})
            return Resp(json.dumps({"response": body}).encode())
        raise OSError("unexpected url")

    hydi.urlopen = fake_urlopen
    hydi.frank_resolve = lambda force=False: None
    r = hydi.advise_proposal("approve $50")
    if r.get("verdict") != "REVIEW" or r.get("confidence") != 0.9 or r.get("executed") is not False:
        fail("frank ok: " + json.dumps(r))
    if r.get("backend") != "frank-ollama":
        fail("backend")


def test_probe_fail_fallback_ok():
    reset_events()
    calls = []

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        calls.append((url, timeout))
        if ":11434/api/tags" in url:
            raise OSError("probe refused")
        if ":8080/" in url:
            body = json.dumps({"verdict": "BLOCK", "confidence": 0.4, "reason": "local"})
            inner = json.dumps({"choices": [{"message": {"content": body}}]})
            return Resp(inner.encode())
        raise OSError("unexpected")

    hydi.urlopen = fake_urlopen
    hydi.LLAMA_MODEL = "local"
    hydi.frank_resolve = lambda force=False: None
    r = hydi.advise_proposal("x")
    if r.get("backend") != "llama-cpp" or r.get("verdict") != "BLOCK":
        fail("fallback ok: " + json.dumps(r))
    if not any(":11434/api/tags" in c[0] for c in calls):
        fail("probe not called")


def test_fallback_timeout_block():
    reset_events()

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if ":11434/api/tags" in url:
            raise OSError("down")
        if ":8080/" in url:
            raise TimeoutError("slow mistral")
        raise OSError("unexpected")

    hydi.urlopen = fake_urlopen
    hydi.frank_resolve = lambda force=False: None
    r = hydi.advise_proposal("x")
    if r.get("verdict") != "BLOCK" or r.get("confidence") != 0.0:
        fail("fallback timeout: " + json.dumps(r))
    if "TimeoutError" not in r.get("reason", ""):
        fail("reason missing timeout")


def test_frank_malformed_block():
    reset_events()

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if ":11434/api/tags" in url:
            return Resp(b'{"models":[]}')
        if ":11434/api/generate" in url:
            return Resp(json.dumps({"response": '{"verdict":"MAYBE","confidence":1}'}).encode())
        raise OSError("unexpected")

    hydi.urlopen = fake_urlopen
    hydi.frank_resolve = lambda force=False: None
    r = hydi.advise_proposal("x")
    if r.get("verdict") != "BLOCK" or r.get("confidence") != 0.0:
        fail("frank malformed: " + json.dumps(r))
    if r.get("backend") != "frank-ollama":
        fail("backend frank-ollama")


def test_fallback_malformed_block():
    reset_events()

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if ":11434/api/tags" in url:
            raise OSError("down")
        if ":8080/" in url:
            inner = json.dumps({"choices": [{"message": {"content": "not json at all"}}]})
            return Resp(inner.encode())
        raise OSError("unexpected")

    hydi.urlopen = fake_urlopen
    hydi.LLAMA_MODEL = "local"
    hydi.frank_resolve = lambda force=False: None
    r = hydi.advise_proposal("x")
    if r.get("verdict") != "BLOCK" or r.get("confidence") != 0.0:
        fail("fallback malformed: " + json.dumps(r))


def main():
    test_frank_ok()
    test_probe_fail_fallback_ok()
    test_fallback_timeout_block()
    test_frank_malformed_block()
    test_fallback_malformed_block()
    print("ok")


if __name__ == "__main__":
    main()