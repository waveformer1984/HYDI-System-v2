#!/usr/bin/env python3
"""QR key import: hydi.py redeems a one-time code with Frank and stores the keys."""

import json
import os
import stat
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("OLLAMA_URL", "http://127.0.0.1:9")
for k in ("HYDI_BOARD_HUMAN_TOKEN", "HYDI_PHONE_READ_TOKEN", "FRANK_HOSTS"):
    os.environ.pop(k, None)

import hydi  # noqa: E402

CODE = "A" * 32
REDEEMS = []


class FakeFrank(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        REDEEMS.append(body["code"])
        if self.path != "/api/phone/provision/redeem":
            self.send_response(404); self.end_headers(); return
        if body["code"] != CODE or len(REDEEMS) > 1:
            self.send_response(400); self.end_headers(); self.wfile.write(b'{"ok":false}'); return
        out = json.dumps({"ok": True, "keys": {
            "HYDI_BOARD_HUMAN_TOKEN": "human-secret",
            "HYDI_PHONE_READ_TOKEN": "read-secret",
            "FRANK_HOSTS": "127.0.0.1",
            "STRIPE_SECRET_KEY": "sk_live_should_be_dropped",
            "HYDI_EVIL": "x\nINJECTED=1",
        }, "missing": ["GROQ_API_KEY"]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main():
    server = HTTPServer(("127.0.0.1", 0), FakeFrank)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    hydi.frank_resolve = lambda force=False: None
    hydi.log_event = lambda *a, **k: None

    # parsing: only well-formed Hydi codes
    for bad in ("", "hello", "hydi-provision:v1?c=short&h=1.2.3.4&p=3000",
                f"hydi-provision:v1?c={CODE}&h=1.2.3.4;rm -rf&p=3000",
                f"https://evil.example/?c={CODE}"):
        try:
            hydi.parse_provision_payload(bad)
            raise AssertionError(f"accepted {bad!r}")
        except ValueError:
            pass
    code, hosts, p = hydi.parse_provision_payload(f"hydi-provision:v1?c={CODE}&h=10.255.255.1,127.0.0.1&p={port}")
    assert (code, hosts, p) == (CODE, ["10.255.255.1", "127.0.0.1"], port)

    tmp = tempfile.mkdtemp()
    env_path = os.path.join(tmp, ".hydi", "thin-client.env")
    os.makedirs(os.path.dirname(env_path))
    with open(env_path, "w") as fh:
        fh.write("OLLAMA_URL=http://frank:11434\nexport HYDI_PHONE_READ_TOKEN=old-token\n# keep me\n")

    # first host is unreachable (blackhole), second is the fake Frank
    payload = f"hydi-provision:v1?c={CODE}&h=127.0.0.1&p={port}"
    result = hydi.provision_from_payload(payload, env_path=env_path)
    assert result["ok"], result
    assert result["set"] == ["FRANK_HOSTS", "HYDI_BOARD_HUMAN_TOKEN", "HYDI_PHONE_READ_TOKEN"], result
    assert result["missing"] == ["GROQ_API_KEY"], result
    assert "secret" not in json.dumps(result), result  # names only, never values

    text = open(env_path).read()
    assert "OLLAMA_URL=http://frank:11434" in text and "# keep me" in text, text
    assert "old-token" not in text and "HYDI_PHONE_READ_TOKEN=read-secret" in text, text
    assert "STRIPE_SECRET_KEY" not in text and "INJECTED" not in text and "HYDI_EVIL" not in text, text
    if os.name != "nt":  # Windows (Frank's local CI) has no POSIX modes
        assert stat.S_IMODE(os.stat(env_path).st_mode) == 0o600, oct(os.stat(env_path).st_mode)
    assert os.environ["HYDI_BOARD_HUMAN_TOKEN"] == "human-secret"
    assert hydi.keys_status()["HYDI_PHONE_READ_TOKEN"] is True

    # the code is single-use: a second scan reports it plainly
    again = hydi.provision_from_payload(payload, env_path=env_path)
    assert again == {"ok": False, "error": "code already used or invalid — show a new QR"}, again

    # not a Hydi QR -> nothing contacted
    before = len(REDEEMS)
    assert hydi.provision_from_payload("WIFI:S:home;;", env_path=env_path)["ok"] is False
    assert len(REDEEMS) == before

    # loopback guard used by both endpoints
    assert hydi._is_loopback("127.0.0.1") and hydi._is_loopback("::1")
    assert not hydi._is_loopback("192.168.86.20") and not hydi._is_loopback("100.87.215.90")
    server.shutdown()
    print("ok")


if __name__ == "__main__":
    main()
