#!/usr/bin/env python3
"""hydi.py /api/fleet reports real probed subsystem state, not a fake mesh."""

import json
import os
import sys
from urllib.error import URLError
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

UP = {"10.9.9.9"}


class Resp:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return b'{"ok": true, "models": [], "messages": []}'


def fake_urlopen(url, *args, **kwargs):
    target = url if isinstance(url, str) else url.full_url
    if urlparse(target).hostname not in UP:
        raise URLError("unreachable")
    return Resp()


def by_id(items, item_id):
    for item in items:
        if item["id"] == item_id:
            return item
    raise SystemExit("missing fleet item " + item_id)


def main():
    db = os.path.join(os.environ.get("TEMP", "/tmp"), "hydi-fleet-test.sqlite")
    for suf in ("", "-wal", "-shm"):
        try:
            os.remove(db + suf)
        except OSError:
            pass
    os.environ["HYDI_BOARD_DB"] = db
    os.environ.pop("HYDI_BOARD_UPSTREAM", None)
    os.environ["FRANK_HOSTS"] = "10.11.12.13,10.9.9.9"
    os.environ.pop("GROQ_API_KEY", None)

    import hydi
    import urllib.request

    # store.py calls urllib.request.urlopen(); hydi.py holds its own urlopen ref.
    urllib.request.urlopen = fake_urlopen
    hydi.urlopen = fake_urlopen
    hydi.OLLAMA_URL = "http://localhost:11434"
    hydi.OLLAMA_MODEL = "qwen2.5:3b"
    hydi.GROQ_API_KEY = ""
    hydi.GROQ_MODEL = None
    hydi.LLAMA_MODEL = "qwen2.5-1.5b"
    hydi._FRANK.update({"host": None, "ts": 0.0, "logged": "unset"})

    items = hydi.fleet_status()

    frank = by_id(items, "frank")
    if frank["status"] != "running" or frank["detail"] != "Frank via Wi-Fi":
        raise SystemExit("frank item wrong: " + json.dumps(frank))
    if os.environ.get("HYDI_BOARD_UPSTREAM") != "http://10.9.9.9:3000":
        raise SystemExit("upstream not set from winner")

    ollama = by_id(items, "ollama")
    if ollama["status"] != "running" or "qwen2.5:3b" not in ollama["detail"]:
        raise SystemExit("ollama item wrong: " + json.dumps(ollama))

    groq = by_id(items, "groq")
    if groq["status"] != "idle" or groq["detail"] != "no API key":
        raise SystemExit("groq item wrong: " + json.dumps(groq))

    llama = by_id(items, "llama")
    if llama["status"] != "running" or llama["detail"] != "qwen2.5-1.5b":
        raise SystemExit("llama item wrong: " + json.dumps(llama))

    board = by_id(items, "board")
    if board["status"] != "running" or "reachable" not in board["detail"]:
        raise SystemExit("board item wrong: " + json.dumps(board))

    if by_id(items, "hydi-py")["status"] != "running":
        raise SystemExit("self item wrong")

    # Frank unreachable: frank and board go error, ollama falls back idle/error
    UP.clear()
    hydi._frank_note_failure()
    hydi.OLLAMA_MODEL = None
    down = hydi.fleet_status()
    if by_id(down, "frank")["status"] != "error":
        raise SystemExit("frank should error when unreachable")
    if by_id(down, "board")["status"] != "error":
        raise SystemExit("board should report offline copy as error")

    # No frank config at all: idle, never probed.
    os.environ.pop("FRANK_HOSTS", None)
    hydi._FRANK.update({"host": None, "ts": 0.0, "logged": "unset"})
    plain = hydi.fleet_status()
    if by_id(plain, "frank")["status"] != "idle":
        raise SystemExit("frank should be idle when unconfigured")

    # stats_payload reports the real count, not the fictional 15.
    stats = hydi.stats_payload()
    if stats["agents_total"] != len(plain) or stats["agents_running"] != sum(
            1 for i in plain if i["status"] == "running"):
        raise SystemExit("stats agents fields still fabricated")

    print("ok")


if __name__ == "__main__":
    main()
