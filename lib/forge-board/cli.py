#!/usr/bin/env python3
"""JSON stdin/stdout bridge so Node can use the sqlite store without node-sqlite3."""

import json
import sys

import store


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError:
        print(json.dumps({"ok": False, "status": 400, "error": "invalid json"}))
        return
    print(json.dumps(store.handle_http(payload)))


if __name__ == "__main__":
    main()
