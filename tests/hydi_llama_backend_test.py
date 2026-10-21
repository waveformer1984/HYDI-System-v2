#!/usr/bin/env python3
"""hydi.py chat reaches llama-server on :8080 when Ollama is down."""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

PORT = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/v1/models":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps({"data": [{"id": "qwen2.5-1.5b"}]}).encode()
        self._send(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        incoming = json.loads(self.rfile.read(length) or b"{}")
        last = incoming["messages"][-1]["content"]
        if last != "hi":
            raise SystemExit("unexpected prompt: " + last)
        body = json.dumps({
            "choices": [{"message": {"content": "from-llama"}}],
        }).encode()
        self._send(body)

    def _send(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    os.environ["GROQ_API_KEY"] = ""
    os.environ["OLLAMA_URL"] = "http://127.0.0.1:9"
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    os.environ["HYDI_LLAMA_URL"] = f"http://127.0.0.1:{port}"
    threading.Thread(target=server.serve_forever, daemon=True).start()

    import hydi
    hydi.GROQ_API_KEY = ""
    hydi.GROQ_MODEL = None
    hydi.OLLAMA_MODEL = None
    hydi.OLLAMA_URL = "http://127.0.0.1:9"
    hydi.LLAMA_URL = os.environ["HYDI_LLAMA_URL"]
    hydi.LLAMA_MODEL = None

    found = hydi.detect_llama()
    if found != "qwen2.5-1.5b":
        raise SystemExit("detect_llama returned " + repr(found))
    reply = hydi.ai_chat([{"role": "user", "content": "hi"}])
    if reply != "from-llama":
        raise SystemExit("llama reply was " + repr(reply))

    hydi.OLLAMA_MODEL = "qwen2.5:1.5b"
    hydi.ollama_chat = lambda messages: "from-ollama"
    preferred = hydi.ai_chat([{"role": "user", "content": "hi"}])
    if preferred != "from-ollama":
        raise SystemExit("ollama should win, got " + repr(preferred))

    payload = hydi.models_payload()
    if payload["mode"] != "ai" or payload["ollama_online"] is not True:
        raise SystemExit("models payload " + json.dumps(payload))

    hydi.OLLAMA_MODEL = None
    hydi.LLAMA_MODEL = "qwen2.5-1.5b"
    llama_only = hydi.models_payload()
    if llama_only["mode"] != "ai" or llama_only["llama_online"] is not True:
        raise SystemExit("llama payload " + json.dumps(llama_only))
    if "llama/" not in hydi.active_ai_label():
        raise SystemExit("label " + hydi.active_ai_label())

    server.shutdown()
    print("ok")


if __name__ == "__main__":
    main()
