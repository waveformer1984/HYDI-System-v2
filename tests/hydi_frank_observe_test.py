#!/usr/bin/env python3
"""Phone Hydi reads Frank's combined snapshot with the read-only token."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("OLLAMA_URL", "http://127.0.0.1:9")
os.environ.pop("HYDI_PHONE_READ_TOKEN", None)

import hydi  # noqa: E402

SNAP = {
    "device": "frank", "at": "2026-10-25T03:00:00.000Z", "level": "CRIT",
    "issues": [
        {"severity": "crit", "id": "pm2-errored-heidi-core", "text": "heidi-core is errored in PM2"},
        {"severity": "warn", "id": "storage-LOW", "text": "storage LOW: 7 GB free"},
    ],
    "host": {"cpuPct": 14, "memFreeGb": 6.2, "memTotalGb": 16, "diskC": {"freeGb": 7, "totalGb": 476.3}, "uptimeHours": 40},
    "pm2": {"available": True, "online": 18, "total": 20},
    "docker": {"available": True, "running": 9, "total": 9},
    "ollama": {"reachable": True},
    "storage": {"level": "LOW", "freeGb": 7},
}


def main():
    hydi.frank_candidates = lambda: ["192.168.86.178"]
    hydi.frank_resolve = lambda force=False: "192.168.86.178"
    hydi.ai_chat = lambda *a, **k: None

    # no token: says why, never guesses
    out = hydi.tool_frank()
    assert out == "Frank: unknown (" + hydi.NO_REVENUE_SOURCE + ").", out
    card = hydi.frank_health_card("192.168.86.178")
    assert card["status"] == "idle" and card["detail"].startswith("not observed"), card

    os.environ["HYDI_PHONE_READ_TOKEN"] = "test-read-token"
    calls = []
    hydi._frank_observe = lambda host, token: calls.append((host, token)) or (SNAP, None)

    out = hydi.tool_frank()
    assert out.startswith("Frank: CRIT (2 issues)"), out
    assert "  !! heidi-core is errored in PM2" in out, out
    assert "  !  storage LOW: 7 GB free" in out, out
    assert "Host: CPU 14%, RAM 6.2/16 GB free, C: 7/476.3 GB free, up 40h" in out, out
    assert "PM2: 18/20 online" in out and "Docker: 9/9 running" in out, out
    assert "nothing was changed" in out and "test-read-token" not in out, out

    # the dashboard card leads with the worst issue and is cached for a minute
    hydi._FRANK_OBS["at"] = 0
    calls.clear()
    card = hydi.frank_health_card("192.168.86.178")
    card2 = hydi.frank_health_card("192.168.86.178")
    assert card["status"] == "error" and card["detail"] == "CRIT · heidi-core is errored in PM2", card
    assert card2 == card and len(calls) == 1, calls

    # chat routes Frank questions to the tool, before the model
    reply = hydi.hydi_reply_ai("how is frank doing?", session_id="f")
    assert reply.startswith("Frank: CRIT"), reply
    reply = hydi.hydi_reply_ai("cpu?", session_id="g")
    assert reply.startswith("Frank: CRIT"), reply

    hydi._frank_observe = lambda host, token: (None, "Frank answered 401")
    assert hydi.tool_frank() == "Frank: unknown (Frank answered 401).", hydi.tool_frank()
    del os.environ["HYDI_PHONE_READ_TOKEN"]
    print("ok")


if __name__ == "__main__":
    main()
