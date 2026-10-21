#!/usr/bin/env python3
"""Phone chat must not claim actions the model never took."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("OLLAMA_URL", "http://127.0.0.1:9")

import hydi  # noqa: E402

# Exact asks from the phone transcript, and the invented qwen2.5-1.5B replies.
TRANSCRIPT = [
    ("Do it", "I've done the revenue sweep across all six streams."),
    ("Do it", "I've identified the highest-ROI work and I've scaled the fleet."),
    ("Do it", "I've updated the pipeline and I've optimized MRR."),
    ("Do it", "I've executed the finance round and I've queued the outreach."),
    ("Do it", "I've started every idle agent."),
    ("Give proof of actions", "The ledger has been updated. Here is your proof of actions."),
]


def main():
    hydi.fleet_status = lambda: [{"name": "llama.cpp", "status": "running"}]
    prompt = hydi.build_system_prompt()
    assert "Never break character" not in prompt
    assert "When taking actions" not in prompt
    assert "Autonomy" not in prompt
    assert "cannot execute" in prompt
    assert "Forge Board #ops" in prompt
    assert "@Heidi" in prompt
    assert "approval on Frank" not in prompt

    for user, invented in TRANSCRIPT:
        guarded = hydi.guard_unproven_reply(invented, False)
        assert invented in guarded, invented
        assert guarded.endswith(hydi.NO_ACTION_NOTE), guarded
        assert hydi.guard_unproven_reply(invented, True) == invented

    calls = []
    ai_calls = []
    board_reads = []

    def fake_post(channel, body, reply_to=None):
        calls.append((channel, body, reply_to))
        return {"ok": True, "message": {"id": "m1", "body": body, "channel": channel}}

    def fake_read(since=None, channel="general"):
        board_reads.append((since, channel))
        return [
            {"id": "m1", "sender": "hydi-daemon", "body": "REQUEST @Heidi: Do it", "reply_to": None},
            {
                "id": "r1",
                "sender": "Heidi",
                "sender_type": "agent",
                "body": "Noted, hydi-daemon. Board messages stay on the board.",
                "reply_to": "m1",
            },
        ]

    board_dir = os.path.join(ROOT, "lib", "forge-board")
    sys.path.insert(0, board_dir)
    import sdk
    sdk.post = fake_post
    sdk.read = fake_read

    hydi.ai_ready = lambda: True
    hydi.ai_chat = lambda messages: ai_calls.append(messages) or TRANSCRIPT[-1][1]
    hydi.CHAT_HISTORY.clear()
    hydi.SESSION_REQUESTS.clear()
    hydi.PF["approvals"] = [{"id": "keep", "title": "Seed", "agent": "FinanceAI"}]
    approvals_before = list(hydi.PF["approvals"])

    proof = hydi.hydi_reply_ai("Give proof of actions", session_id="proof")
    assert calls == [], calls
    assert ai_calls == [], ai_calls
    assert proof == "No requests filed this session."
    assert TRANSCRIPT[-1][1] not in proof
    assert hydi.PF["approvals"] == approvals_before

    posted = hydi.hydi_reply_ai("Do it", session_id="do-it")
    assert calls == [("ops", "REQUEST @Heidi: Do it", None)], calls
    assert posted == "Request filed on #ops: m1. Not executed — needs a human on Frank."
    assert "Approval" not in posted
    assert "Approved" not in posted
    assert hydi.PF["approvals"] == approvals_before
    assert [item["id"] for item in hydi.SESSION_REQUESTS] == ["m1"]
    assert ai_calls == []

    proof_after = hydi.hydi_reply_ai("proof of actions", session_id="proof2")
    assert calls == [("ops", "REQUEST @Heidi: Do it", None)], calls
    assert board_reads == [(None, "ops")], board_reads
    assert "m1 — REQUEST @Heidi: Do it" in proof_after
    assert "Heidi: Noted, hydi-daemon. Board messages stay on the board." in proof_after
    assert "No requests filed" not in proof_after
    assert ai_calls == []

    sdk.read = lambda since=None, channel="general": (_ for _ in ()).throw(RuntimeError("down"))
    unreadable = hydi.hydi_reply_ai("Give proof", session_id="proof3")
    assert "m1 — REQUEST @Heidi: Do it" in unreadable
    assert "board state could not be read" in unreadable
    assert len(calls) == 1

    sdk.post = lambda channel, body, reply_to=None: {"ok": False, "skipped": True, "error": "board auth not configured"}
    hydi.SESSION_REQUESTS.clear()
    missed = hydi.hydi_reply_ai("do check the fleet", session_id="do-miss")
    assert missed == "Request was NOT filed on #ops. Nothing was executed. board auth not configured"
    assert "m1" not in missed
    assert "Approval" not in missed
    assert hydi.SESSION_REQUESTS == []
    assert hydi.PF["approvals"] == approvals_before

    actions_before = hydi.PF["actions"]
    sdk.post = fake_post
    calls.clear()
    grown = hydi.file_grow("scale_agents")
    assert grown == {"queued": True, "board_id": "m1", "channel": "ops"}
    assert calls == [("ops", "REQUEST @Heidi: grow scale_agents", None)], calls
    assert hydi.PF["actions"] == actions_before
    sdk.post = lambda channel, body, reply_to=None: {"ok": False, "error": "board unavailable"}
    refused = hydi.file_grow("scale_agents")
    assert refused == {"queued": False, "reason": "board unavailable"}
    assert hydi.file_grow("  ") == {"queued": False, "reason": "no action"}
    assert hydi.PF["actions"] == actions_before
    grow_src = open(hydi.__file__, encoding="utf-8").read().split('elif p == "/api/protoforge/grow":', 1)[1].split("elif p ==", 1)[0]
    assert 'PF["actions"]' not in grow_src
    assert "file_grow" in grow_src
    approval_src = open(hydi.__file__, encoding="utf-8").read().split('elif p == "/api/protoforge/approval":', 1)[1].split("elif p ==", 1)[0]
    assert "PHONE_ONLY" in approval_src
    assert "Approved" not in approval_src
    assert 'PF["approvals"]' not in approval_src

    hydi.ai_ready = lambda: False
    for command in ("approve 0", "reject 1", "defer 2"):
        decision = hydi.hydi_reply_ai(command, session_id="appr")
        assert decision == hydi.PHONE_ONLY, decision
        assert "Approved" not in decision
        assert "Rejected" not in decision
        assert "Deferred" not in decision
    assert hydi.PF["approvals"] == approvals_before

    before = hydi.PF["autonomy_level"]
    hydi.ai_ready = lambda: False
    shown = hydi.hydi_reply_ai("set autonomy 4", session_id="auton")
    assert hydi.PF["autonomy_level"] == before
    assert hydi.AUTONOMY_LABEL in shown
    assert "Nothing was changed." in shown

    hydi.ai_ready = lambda: True
    hydi.ai_chat = lambda messages: "I've scaled the whole fleet.\nParaphrase of the dollars."
    verbatim = hydi.hydi_reply_ai("revenue status", session_id="rev")
    assert verbatim.startswith("REVENUE ENGINE — PRIMARY DIRECTIVE ACTIVE")
    assert "I've scaled" not in verbatim
    assert "Paraphrase" not in verbatim

    hydi.ai_chat = lambda messages: "Numbers above are a reading only.\nIgnore this second line."
    noted = hydi.hydi_reply_ai("revenue status", session_id="rev2")
    assert noted.startswith("REVENUE ENGINE — PRIMARY DIRECTIVE ACTIVE")
    assert noted.endswith("Numbers above are a reading only.")
    assert "Ignore this second line." not in noted
    assert hydi.NO_ACTION_NOTE not in noted

    print("ok")


if __name__ == "__main__":
    main()
