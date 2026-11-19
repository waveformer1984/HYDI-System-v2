#!/usr/bin/env python3
"""Phone advisor: Frank Ollama then llama.cpp fallback; never executes."""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ["FRANK_IP"] = "10.20.30.40"
os.environ.pop("FRANK_HOSTS", None)

import hydi  # noqa: E402

calls = []


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


def fake_urlopen(req, timeout=None):
    url = req.full_url if hasattr(req, "full_url") else str(req)
    calls.append((url, timeout))
    if ":11434/api/tags" in url:
        return Resp(b'{"models":[{"name":"qwen2.5:3b-instruct-q4_K_M"}]}')
    if ":11434/api/generate" in url:
        body = json.dumps({
            "verdict": "REVIEW",
            "confidence": 0.9,
            "reason": "needs human",
        })
        return Resp(json.dumps({"response": body}).encode())
    if ":8080/" in url:
        if timeout and timeout > 3:
            raise OSError("timeout too long for fallback test")
        body = json.dumps({
            "verdict": "BLOCK",
            "confidence": 0.4,
            "reason": "fallback path",
        })
        inner = json.dumps({
            "choices": [{"message": {"content": body}}],
        })
        return Resp(inner.encode())
    raise OSError("unreachable")


def main():
    hydi.urlopen = fake_urlopen
    hydi._probe = lambda url: ":11434" in url
    hydi.frank_resolve = lambda force=False: None
    hydi.LLAMA_MODEL = "local-qwen"

    r1 = hydi.advise_proposal("approve $50 test charge")
    if r1.get("verdict") != "REVIEW" or r1.get("executed") is not False:
        raise SystemExit("frank path: " + json.dumps(r1))
    if r1.get("backend") != "frank-ollama":
        raise SystemExit("expected frank-ollama backend")

    hydi._probe = lambda url: False
    calls.clear()
    r2 = hydi.advise_proposal("approve $50 test charge")
    if r2.get("verdict") != "BLOCK" or r2.get("backend") != "llama-cpp":
        raise SystemExit("fallback path: " + json.dumps(r2))
    if not any(":8080" in c[0] for c in calls):
        raise SystemExit("expected llama.cpp call")
    if not any(c[1] is not None and c[1] <= 3 for c in calls if ":8080" in c[0]):
        raise SystemExit("fallback timeout must be <=3s")

    bad = hydi.parse_phone_advisor_verdict('{"verdict":"MAYBE","confidence":1}')
    if bad is not None:
        raise SystemExit("invalid verdict must be rejected")

    events = [e["text"] for e in hydi.PF["events"]]
    if not any("falling back" in t for t in events):
        raise SystemExit("missing fallback log line")

    print("ok")


if __name__ == "__main__":
    main()