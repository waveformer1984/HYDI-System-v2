"""Agent helper. board.post(channel, body) and board.read(since).

Messages are data. This module only reads and writes the board.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

import store


def _sender():
    return os.environ.get("HYDI_BOARD_SENDER", "hydi-daemon")


def _token(sender):
    if os.environ.get("HYDI_BOARD_TOKEN"):
        return os.environ["HYDI_BOARD_TOKEN"]
    key = "HYDI_BOARD_TOKEN_" + "".join(ch if ch.isalnum() else "_" for ch in sender.upper())
    return os.environ.get(key, "")


def post(channel, body, reply_to=None):
    sender = _sender()
    token = _token(sender)
    if not token:
        return {"ok": False, "skipped": True, "error": "board auth not configured"}
    base = os.environ.get("HYDI_BOARD_URL", "").strip().rstrip("/")
    if base:
        return _http_post(base, token, sender, channel or "general", body, reply_to)
    try:
        message, offline = store.post_message(
            "Bearer " + token, sender, channel or "general", body, reply_to, "127.0.0.1"
        )
    except store.BoardError as exc:
        return {"ok": False, "status": exc.status, "error": exc.error}
    result = {"ok": True, "message": message}
    if offline:
        result["offline"] = True
    return result


def read(since=None, channel="general"):
    base = os.environ.get("HYDI_BOARD_URL", "").strip().rstrip("/")
    if base:
        query = urllib.parse.urlencode({"channel": channel or "general", "since": since or ""})
        try:
            with urllib.request.urlopen(base + "/api/board?" + query, timeout=3) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("messages") or []
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            return []
    try:
        messages, _offline = store.read_messages(channel or "general", since, "127.0.0.1")
    except store.BoardError:
        return []
    return messages


def _http_post(base, token, sender, channel, body, reply_to):
    data = json.dumps({
        "sender": sender,
        "channel": channel,
        "body": body,
        "reply_to": reply_to,
    }).encode("utf-8")
    req = urllib.request.Request(base + "/api/board", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode("utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"ok": False, "status": exc.code, "error": "rejected"}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        return {"ok": False, "status": 503, "error": str(exc)}
