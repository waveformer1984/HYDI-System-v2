#!/usr/bin/env python3
"""Phone fleet surfaces heidi-agent Phase 2 via Frank observe (not direct :3462)."""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("HYDI_PHONE_READ_TOKEN", "probe-token")

import hydi  # noqa: E402

SNAP = {
    "device": "frank",
    "at": "2026-11-19T03:00:00.000Z",
    "level": "OK",
    "issues": [],
    "heidiAgentLoop": {
        "reachable": True,
        "lease_held": True,
        "cycles": 2,
        "allow_exec": False,
        "last_cycle_at": "2026-11-19T02:59:00.000Z",
    },
}


def main():
    hydi.frank_candidates = lambda: ["100.1.2.3"]
    hydi.frank_resolve = lambda force=False: "100.1.2.3"
    hydi._frank_observe = lambda host, token: (dict(SNAP), None)
    hydi._FRANK_OBS["at"] = 0

    card = hydi.frank_heidi_agent_card("100.1.2.3")
    if card["status"] != "running" or "exec off" not in card["detail"]:
        raise SystemExit("card wrong: " + json.dumps(card))
    if "cycles=2" not in card["detail"]:
        raise SystemExit("missing cycles: " + card["detail"])

    out = hydi.tool_frank()
    if "Heidi agent: exec OFF" not in out:
        raise SystemExit("tool_frank missing agent line: " + out)

    fleet = hydi.fleet_status()
    agent = next((i for i in fleet if i["id"] == "heidi-agent"), None)
    if not agent or agent["status"] != "running":
        raise SystemExit("fleet missing heidi-agent: " + json.dumps(fleet))

    bad = dict(SNAP)
    bad["heidiAgentLoop"] = {"reachable": True, "allow_exec": True, "lease_held": True, "cycles": 0}
    hydi._frank_observe = lambda h, t: (bad, None)
    hydi._FRANK_OBS["at"] = 0
    warn = hydi.frank_heidi_agent_card("100.1.2.3")
    if warn["status"] != "error" or "allow_exec" not in warn["detail"]:
        raise SystemExit("allow_exec should error: " + json.dumps(warn))

    print("ok")


if __name__ == "__main__":
    main()