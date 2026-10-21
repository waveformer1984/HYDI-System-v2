#!/usr/bin/env python3
"""Grow and agent commands file one #ops REQUEST and never touch fake state."""

import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("OLLAMA_URL", "http://127.0.0.1:9")

import hydi  # noqa: E402

FILED = "Request filed on #ops: {id}. Not executed — needs a human on Frank."

COMMANDS = [
    ("grow outreach", "REQUEST @Heidi: grow outreach — revenue outreach sweep across all streams"),
    ("grow agents", "REQUEST @Heidi: grow agents — start all idle agents"),
    ("start all agents", "REQUEST @Heidi: grow agents — start all idle agents"),
    ("grow finance", "REQUEST @Heidi: grow finance — capital allocation round"),
    ("finance round", "REQUEST @Heidi: grow finance — capital allocation round"),
    ("grow evolution", "REQUEST @Heidi: grow evolution — CASCADE evolution cycle"),
    ("start outreach", "REQUEST @Heidi: start agent outreach"),
    ("pause marketing", "REQUEST @Heidi: pause agent marketing"),
]

CLAIMS = (
    "activated", "queued across", "15 leads", "Started ", "complete", "Deployed",
    "protocol running", "optimising", "started.", "paused.",
)


def main():
    hydi.fleet_status = lambda: [{"name": "llama.cpp", "status": "running", "detail": "ok"}]
    board_dir = os.path.join(ROOT, "lib", "forge-board")
    sys.path.insert(0, board_dir)
    import sdk

    calls = []

    def fake_post(channel, body, reply_to=None):
        calls.append((channel, body))
        return {"ok": True, "message": {"id": f"m{len(calls)}"}}

    sdk.post = fake_post
    hydi.ai_ready = lambda: True
    ai_calls = []
    hydi.ai_chat = lambda messages: ai_calls.append(messages) or "I've started everything."
    hydi.SESSION_REQUESTS.clear()
    hydi.PF["approvals"] = []

    for key in ("agents", "actions", "success_rate", "trust_score"):
        assert key not in hydi.PF, key
    before = copy.deepcopy({k: hydi.PF[k] for k in ("approvals", "capital", "revenue_streams")})

    for i, (command, body) in enumerate(COMMANDS, start=1):
        reply = hydi.hydi_reply_ai(command, session_id="grow")
        assert reply == FILED.format(id=f"m{i}"), (command, reply)
        assert calls[-1] == ("ops", body), (command, calls[-1])
        for claim in CLAIMS:
            assert claim not in reply, (command, claim)
    assert ai_calls == [], "filing replies must not get an AI aside"
    assert len(calls) == len(COMMANDS)
    assert [r["id"] for r in hydi.SESSION_REQUESTS] == [f"m{i}" for i in range(1, len(COMMANDS) + 1)]
    assert {k: hydi.PF[k] for k in before} == before

    sdk.post = lambda channel, body, reply_to=None: {"ok": False, "error": "board unavailable"}
    refused = hydi.hydi_reply_ai("grow finance", session_id="grow")
    assert refused == "Request was NOT filed on #ops. Nothing was executed. board unavailable"
    assert hydi.PF["capital"] is None

    assert hydi._handle_command("start nobody") is None

    stats = hydi.stats_payload()
    for key in ("capital_deployed", "total_mrr", "agent_actions", "success_rate", "trust_score"):
        assert stats[key] is None, key
    assert stats["requests_filed"] == len(COMMANDS)
    json.dumps(stats)
    health = hydi.health_payload()
    assert health["auto_heals_24h"] is None
    assert health["trend_status"] == "unknown"
    assert health["jobs_queued"] is None

    hydi.ai_ready = lambda: False
    revenue = hydi._handle_command("revenue status")
    assert "Total MRR: unknown  |  Capital: unknown" in revenue
    assert "$0" not in revenue
    assert "PRIMARY DIRECTIVE ACTIVE" not in revenue
    finance = hydi._scripted_fallback("capital")
    assert "Capital: unknown  |  MRR: unknown" in finance
    status = hydi._scripted_fallback("status")
    assert "Capital: unknown" in status
    assert hydi._scripted_fallback("approvals") == "No phone approvals. Requests live on Forge Board #ops."
    prompt = hydi.build_system_prompt()
    assert "MRR: unknown. Capital: unknown." in prompt

    hydi.PF["revenue_streams"]["rezonate"]["mrr"] = 120
    assert hydi.total_mrr() is None
    for s in hydi.PF["revenue_streams"].values():
        s["mrr"] = 10
    assert hydi.total_mrr() == 10 * len(hydi.REVENUE_STREAMS)
    assert hydi._money(1500) == "$1,500"

    src = open(hydi.__file__, encoding="utf-8").read()
    assert 'PF["actions"]' not in src
    assert 'PF["agents"]' not in src
    assert 'PF["capital"] +=' not in src
    assert 'PF["approvals"].append' not in src
    assert "ALL 15 RUNNING" not in src
    assert "demo-001" not in src
    agents_route = src.split('elif p.startswith("/api/protoforge/agents/"):', 1)[1].split("elif p ==", 1)[0]
    assert "file_request" in agents_route

    print("ok")


if __name__ == "__main__":
    main()
