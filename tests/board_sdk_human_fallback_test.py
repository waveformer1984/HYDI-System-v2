#!/usr/bin/env python3
"""Phone posts to the board as Jordan when it holds no agent token."""

import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(ROOT, "lib", "forge-board")
sys.path.insert(0, BOARD)

TMP = tempfile.mkdtemp(prefix="board-human-")
os.environ["HYDI_BOARD_DB"] = os.path.join(TMP, "board.sqlite")
for key in list(os.environ):
    if key.startswith("HYDI_BOARD_TOKEN") or key in ("HYDI_BOARD_URL", "HYDI_BOARD_UPSTREAM", "HYDI_BOARD_AGENT_TOKENS"):
        del os.environ[key]

import sdk  # noqa: E402


def check(cond, label):
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)


def main():
    os.environ["HYDI_BOARD_SENDER"] = "hydi-daemon"

    # No tokens at all: still refuses, with the same error as before.
    os.environ.pop("HYDI_BOARD_HUMAN_TOKEN", None)
    res = sdk.post("ops", "REQUEST @Heidi: check disk space")
    check(res.get("ok") is False and res.get("error") == "board auth not configured", f"no-token refusal: {res}")

    # Only Jordan's login on the device: the post goes out as Jordan.
    os.environ["HYDI_BOARD_HUMAN_TOKEN"] = "human-test-token-0123456789"
    res = sdk.post("ops", "REQUEST @Heidi: check disk space")
    check(res.get("ok") is True, f"human fallback posts: {res}")
    msg = res.get("message") or {}
    check(msg.get("sender") == "Jordan", f"posted as Jordan: {msg}")
    check(msg.get("sender_type") == "human", f"human sender type: {msg}")

    # An agent token wins when present: nothing changes for Frank's agents.
    os.environ["HYDI_BOARD_TOKEN_HYDI_DAEMON"] = "daemon-test-token-0123456789"
    res = sdk.post("ops", "hydi-daemon online")
    check(res.get("ok") is True, f"agent post: {res}")
    check((res.get("message") or {}).get("sender") == "hydi-daemon", f"agent token keeps agent sender: {res}")

    print("ok")


if __name__ == "__main__":
    main()
