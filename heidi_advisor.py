#!/usr/bin/env python3
"""
heidi_advisor.py — Termux phone action advisor (thin client).

Named heidi_advisor.py so it does not overwrite ~/hydi/heidi.py on device.

Uses FRANK_IP / FRANK_HOSTS → Frank Ollama (qwen2.5:3b-instruct-q4_K_M), else
local llama.cpp :8080. Returns AUTO-APPROVE | REVIEW | BLOCK only; never
executes actions.

Usage:
    python heidi_advisor.py advise "Restart heidi-core after deploy"
    echo '{"action":"payout"}' | python heidi_advisor.py advise
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import hydi  # noqa: E402


def main(argv=None):
    args = argv if argv is not None else sys.argv[1:]
    if not args or args[0] != "advise":
        print("usage: python heidi_advisor.py advise <proposal text>", file=sys.stderr)
        return 2
    proposal = " ".join(args[1:]).strip()
    if not proposal and not sys.stdin.isatty():
        proposal = sys.stdin.read().strip()
    if not proposal:
        print("empty proposal", file=sys.stderr)
        return 2
    result = hydi.advise_proposal(proposal)
    print(json.dumps(result))
    return 0 if result.get("verdict") in hydi.ADVISOR_VERDICTS else 1


if __name__ == "__main__":
    raise SystemExit(main())