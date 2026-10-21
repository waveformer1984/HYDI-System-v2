#!/usr/bin/env python3
"""Fake forge-board upstream for tests.

Usage: python board_fake_upstream.py <port|0> <received-log-path>

GET  /api/board -> {ok, messages}   (serves everything POSTed so far)
POST /api/board -> {ok, message}    (records {authorization, body} as a JSON
                                     line in the log and stores the message)
Prints "READY <port>" on stdout once listening.
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

stored = []
next_id = [0]
log_path = sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._json({"ok": True, "messages": stored})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        incoming = json.loads(self.rfile.read(length) or b"{}")
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "authorization": self.headers.get("Authorization"),
                "body": incoming,
            }) + "\n")
        next_id[0] += 1
        message = {
            "id": "srv-%d" % next_id[0],
            "ts": "2026-10-21T00:00:%02d.000Z" % next_id[0],
            "sender": incoming.get("sender"),
            "sender_type": "human",
            "channel": incoming.get("channel") or "general",
            "body": incoming.get("body"),
            "reply_to": incoming.get("reply_to"),
            "mentions": [],
        }
        stored.append(message)
        self._json({"ok": True, "message": message})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("READY %d" % server.server_address[1], flush=True)
    try:
        while True:
            threading.Event().wait(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
