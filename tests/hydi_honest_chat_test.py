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

    for user, invented in TRANSCRIPT:
        guarded = hydi.guard_unproven_reply(invented, False)
        assert invented in guarded, invented
        assert guarded.endswith(hydi.NO_ACTION_NOTE), guarded
        assert hydi.guard_unproven_reply(invented, True) == invented

    hydi.ai_ready = lambda: True
    hydi.CHAT_HISTORY.clear()
    hydi.ai_chat = lambda messages: TRANSCRIPT[-1][1]
    proof = hydi.hydi_reply_ai("Give proof of actions", session_id="proof")
    assert TRANSCRIPT[-1][1] in proof
    assert proof.endswith(hydi.NO_ACTION_NOTE)
    assert "I've " not in proof.split(hydi.NO_ACTION_NOTE)[0] or "proof" in proof

    calls = []

    def fake_post(channel, body, reply_to=None):
        calls.append((channel, body, reply_to))
        return {"ok": True, "message": {"id": "m1"}}

    board_dir = os.path.join(ROOT, "lib", "forge-board")
    sys.path.insert(0, board_dir)
    import sdk
    sdk.post = fake_post
    hydi.CHAT_HISTORY.clear()
    posted = hydi.hydi_reply_ai("Do it", session_id="do-it")
    assert calls == [("ops", "REQUEST @Heidi: Do it", None)], calls
    assert posted == "Request posted to Forge Board #ops for @Heidi. Nothing was executed."
    assert "I've done" not in posted

    sdk.post = lambda channel, body, reply_to=None: {"ok": False, "skipped": True}
    missed = hydi.hydi_reply_ai("do check the fleet", session_id="do-miss")
    assert missed.startswith("Request was NOT posted")
    assert "Nothing was executed." in missed

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
