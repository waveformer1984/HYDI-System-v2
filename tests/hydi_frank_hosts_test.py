#!/usr/bin/env python3
"""hydi.py FRANK_HOSTS multi-link resolution: probe, cache, fail-over."""

import os
import sys
from urllib.error import URLError
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


class Resp:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return b'{"models": []}'


UP = {"192.168.86.178", "100.118.182.126"}
calls = []


def fake_urlopen(url, *args, **kwargs):
    target = url if isinstance(url, str) else url.full_url
    calls.append(target)
    if urlparse(target).hostname not in UP:
        raise URLError("unreachable")
    return Resp()


def main():
    os.environ.pop("GROQ_API_KEY", None)
    os.environ.pop("OLLAMA_URL", None)
    os.environ["FRANK_HOSTS"] = "10.9.9.9,192.168.86.178,100.118.182.126"
    os.environ.pop("HYDI_BOARD_UPSTREAM", None)

    import hydi
    hydi.urlopen = fake_urlopen
    hydi.OLLAMA_URL = "http://localhost:11434"

    # First dead host skipped; Wi-Fi IP wins before the Tailscale entry.
    winner = hydi.frank_resolve(force=True)
    if winner != "192.168.86.178":
        raise SystemExit("expected Wi-Fi host, got " + repr(winner))
    if hydi.frank_link() != "Frank via Wi-Fi":
        raise SystemExit("bad link label " + hydi.frank_link())
    if os.environ.get("HYDI_BOARD_UPSTREAM") != "http://192.168.86.178:3000":
        raise SystemExit("upstream env not set: " + repr(os.environ.get("HYDI_BOARD_UPSTREAM")))
    if hydi.ollama_base() != "http://192.168.86.178:11434":
        raise SystemExit("ollama base wrong: " + hydi.ollama_base())

    # Cached winner: resolving again must not re-probe.
    calls.clear()
    if hydi.frank_resolve() != "192.168.86.178" or calls:
        raise SystemExit("cache miss re-probed: " + repr(calls))

    # Wi-Fi drops out: invalidation re-probes and Tailscale takes over.
    UP.discard("192.168.86.178")
    hydi._frank_note_failure()
    if hydi.frank_resolve() != "100.118.182.126":
        raise SystemExit("failover failed")
    if hydi.frank_link() != "Frank via Tailscale":
        raise SystemExit("tailscale label wrong")
    if hydi.ollama_base() != "http://100.118.182.126:11434":
        raise SystemExit("ollama base did not follow tailscale")

    # All links down: offline, and a forced probe finds nobody.
    UP.clear()
    hydi._frank_note_failure()
    if hydi.frank_resolve(force=True) is not None:
        raise SystemExit("expected offline")
    if hydi.frank_link() != "Offline copy":
        raise SystemExit("offline label wrong")
    # Ollama falls back to the plain OLLAMA_URL default.
    if "11434" not in hydi.ollama_base():
        raise SystemExit("ollama fallback wrong: " + hydi.ollama_base())

    # FRANK_IP alone works as a one-host list (backward compat).
    os.environ.pop("FRANK_HOSTS", None)
    os.environ["FRANK_IP"] = "100.118.182.126"
    UP.add("100.118.182.126")
    hydi._frank_note_failure()
    if hydi.frank_resolve(force=True) != "100.118.182.126":
        raise SystemExit("FRANK_IP fallback failed")

    # No Frank config at all: never probed, legacy env path untouched.
    os.environ.pop("FRANK_IP", None)
    hydi._FRANK.update({"host": None, "ts": 0.0, "logged": "unset"})
    calls.clear()
    if hydi.frank_resolve() is not None or calls:
        raise SystemExit("probed with no frank config")
    os.environ["OLLAMA_URL"] = "http://localhost:11434"
    hydi.OLLAMA_URL = os.environ["OLLAMA_URL"]
    if hydi.ollama_base() != "http://localhost:11434":
        raise SystemExit("legacy OLLAMA_URL not honored")

    print("ok")


if __name__ == "__main__":
    main()
