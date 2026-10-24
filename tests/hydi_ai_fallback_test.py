#!/usr/bin/env python3
"""When the AI backend doesn't answer, chat says so honestly; remote Ollama gets time to load."""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("OLLAMA_URL", "http://127.0.0.1:9")

import hydi  # noqa: E402


def check(cond, label):
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)


def main():
    hydi.fleet_status = lambda: [{"name": "ollama", "status": "running", "detail": "ok"}]
    msg = "how is today going for us"

    # 1. An AI backend is configured but returns nothing: say it didn't answer.
    hydi.ai_ready = lambda: True
    hydi.ai_chat = lambda messages: None
    reply = hydi.hydi_reply_ai(msg, "s-ai-failed")
    check(hydi.AI_NO_ANSWER in reply, f"ai-failed reply names the timeout: {reply!r}")
    check("install Ollama" not in reply, "no stale install-Ollama tip when AI failed")

    # 2. No backend at all: a plain scripted notice, still no install tip.
    hydi.ai_ready = lambda: False
    reply = hydi.hydi_reply_ai(msg, "s-no-ai")
    check(hydi.NO_AI_BACKEND in reply, f"no-backend reply says so: {reply!r}")
    check("install Ollama" not in reply, "no stale install-Ollama tip without AI")

    # 3. Remote Ollama chat: long timeout and keep_alive so the model stays loaded.
    seen = {}

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        seen["timeout"] = timeout
        seen["payload"] = json.loads(req.data)
        return Resp(json.dumps({"message": {"content": "hi there"}}).encode())

    hydi.urlopen = fake_urlopen
    hydi.OLLAMA_MODEL = "qwen2.5:3b"
    hydi.ollama_is_remote = lambda url=None: True
    out = hydi.ollama_chat([{"role": "user", "content": "hi"}])
    check(out == "hi there", f"remote chat returns content: {out!r}")
    check(seen["timeout"] == hydi.OLLAMA_REMOTE_CHAT_TIMEOUT, f"remote timeout used: {seen['timeout']}")
    check(seen["timeout"] >= 120, "remote timeout allows a cold model load")
    check(seen["payload"].get("keep_alive") == "30m", "keep_alive keeps the model loaded")

    hydi.ollama_is_remote = lambda url=None: False
    hydi.ollama_chat([{"role": "user", "content": "hi"}])
    check(seen["timeout"] == 60, f"local timeout unchanged: {seen['timeout']}")

    print("ok")


if __name__ == "__main__":
    main()
