#!/usr/bin/env python3
"""Forge Board store.

Messages live in sqlite3 (stdlib, works on Termux). When SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY are set, rows are mirrored to public.board_messages.
When HYDI_BOARD_UPSTREAM is set, that HTTP board is the shared room and sqlite
is the offline copy.

This module never spawns a shell, never calls Stripe, and never inserts a task.
A message body is stored text, not an instruction.
"""

import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

CHANNELS = ("general", "ops", "alerts")
MAX_BODY = 4000
AGENT_RATE = 10
MENTION_RE = re.compile(r"@([A-Za-z0-9_-]{1,32})")
SENDER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$")
ALIASES = {
    "HEIDI": "Heidi",
    "URSULA": "Ursula",
    "URSILA": "Ursula",
    "CASCADE": "CASCADE",
    "KILO": "KILO",
    "PROTOFORGE": "ProtoForge",
    "HYVE": "Hyve",
    "HYDI_DAEMON": "hydi-daemon",
}

_LOCK = threading.Lock()


class BoardError(Exception):
    def __init__(self, status, error):
        super().__init__(error)
        self.status = status
        self.error = error


def db_path():
    override = os.environ.get("HYDI_BOARD_DB", "").strip()
    if override:
        folder = os.path.dirname(override)
        if folder:
            os.makedirs(folder, exist_ok=True)
        return override
    home = os.path.expanduser("~/.hydi")
    os.makedirs(home, exist_ok=True)
    return os.path.join(home, "forge-board.sqlite")


def connect():
    conn = sqlite3.connect(db_path(), timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS board_messages (
          id TEXT PRIMARY KEY,
          ts TEXT NOT NULL,
          sender TEXT NOT NULL,
          sender_type TEXT NOT NULL,
          channel TEXT NOT NULL,
          body TEXT NOT NULL,
          reply_to TEXT,
          mentions TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS board_messages_channel_ts ON board_messages (channel, ts)"
    )
    return conn


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _token_ok(got, expected):
    if not got or not expected:
        return False
    a = hashlib.sha256(got.encode("utf-8")).digest()
    b = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(a, b)


def load_identities():
    """token -> {sender, sender_type}. Human token wins if a value is reused."""
    found = {}
    for key, value in os.environ.items():
        if not key.startswith("HYDI_BOARD_TOKEN_") or not value.strip():
            continue
        suffix = key[len("HYDI_BOARD_TOKEN_"):]
        sender = ALIASES.get(suffix, suffix)
        if SENDER_RE.match(sender):
            found[value.strip()] = {"sender": sender, "sender_type": "agent"}
    extra = os.environ.get("HYDI_BOARD_AGENT_TOKENS", "")
    for part in extra.split(","):
        if ":" not in part:
            continue
        name, token = part.split(":", 1)
        name, token = name.strip(), token.strip()
        if SENDER_RE.match(name) and token:
            found[token] = {"sender": name, "sender_type": "agent"}
    human = os.environ.get("HYDI_BOARD_HUMAN_TOKEN", "").strip()
    human_name = os.environ.get("HYDI_BOARD_HUMAN_NAME", "Jordan").strip() or "Jordan"
    if human and SENDER_RE.match(human_name):
        found[human] = {"sender": human_name, "sender_type": "human"}
    return found


def identify(authorization):
    identities = load_identities()
    if not identities:
        raise BoardError(503, "board auth not configured")
    raw = str(authorization or "").strip()
    bearer = raw[7:].strip() if raw.lower().startswith("bearer ") else ""
    if not bearer:
        raise BoardError(401, "bearer token required")
    for token, ident in identities.items():
        if _token_ok(bearer, token):
            return ident
    raise BoardError(401, "unknown sender")


def is_internal_ip(ip):
    raw = str(ip or "").split("%", 1)[0].strip().lower()
    if raw.startswith("::ffff:"):
        raw = raw[7:]
    if raw in ("127.0.0.1", "::1", "localhost"):
        return True
    if ":" in raw:
        head = raw.split(":", 1)[0] or "0"
        try:
            first = int(head, 16)
        except ValueError:
            return False
        return (first & 0xFE00) == 0xFC00 or (first & 0xFFC0) == 0xFE80
    parts = raw.split(".")
    if len(parts) != 4:
        return False
    try:
        octets = [int(part) for part in parts]
    except ValueError:
        return False
    if any(n < 0 or n > 255 for n in octets):
        return False
    a, b = octets[0], octets[1]
    if a == 10:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    if a == 192 and b == 168:
        return True
    if a == 100 and 64 <= b <= 127:
        return True
    if a == 169 and b == 254:
        return True
    return False


def _mentions(body):
    found = []
    for match in MENTION_RE.finditer(body):
        name = match.group(1)
        if name not in found:
            found.append(name)
    return found[:20]


def _row_to_message(row):
    mentions = row["mentions"]
    if isinstance(mentions, str):
        try:
            mentions = json.loads(mentions)
        except json.JSONDecodeError:
            mentions = []
    return {
        "id": row["id"],
        "ts": row["ts"],
        "sender": row["sender"],
        "sender_type": row["sender_type"],
        "channel": row["channel"],
        "body": row["body"],
        "reply_to": row["reply_to"],
        "mentions": mentions or [],
    }


def _insert_local(message):
    with _LOCK:
        conn = connect()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO board_messages
                  (id, ts, sender, sender_type, channel, body, reply_to, mentions)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message["id"],
                    message["ts"],
                    message["sender"],
                    message["sender_type"],
                    message["channel"],
                    message["body"],
                    message["reply_to"],
                    json.dumps(message["mentions"]),
                ),
            )
            conn.commit()
        finally:
            conn.close()


def _recent_agent_count(sender):
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    with _LOCK:
        conn = connect()
        try:
            row = conn.execute(
                """
                SELECT COUNT(*) AS n FROM board_messages
                WHERE sender = ? AND sender_type = 'agent' AND ts >= ?
                """,
                (sender, cutoff),
            ).fetchone()
            return int(row["n"])
        finally:
            conn.close()


def _get_local(message_id):
    with _LOCK:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM board_messages WHERE id = ?", (message_id,)).fetchone()
            return _row_to_message(row) if row else None
        finally:
            conn.close()


def sqlite_read(channel, since):
    with _LOCK:
        conn = connect()
        try:
            if since:
                rows = conn.execute(
                    """
                    SELECT * FROM board_messages
                    WHERE channel = ? AND ts > ?
                    ORDER BY ts ASC
                    LIMIT 200
                    """,
                    (channel, since),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM board_messages
                    WHERE channel = ?
                    ORDER BY ts DESC
                    LIMIT 200
                    """,
                    (channel,),
                ).fetchall()
                rows = list(reversed(rows))
            return [_row_to_message(row) for row in rows]
        finally:
            conn.close()


def _supabase_config():
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        return None
    return url, key


def _supabase_request(method, query, payload):
    cfg = _supabase_config()
    if not cfg:
        return None
    url, key = cfg
    endpoint = url + "/rest/v1/board_messages"
    if query:
        endpoint += "?" + urllib.parse.urlencode(query)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(endpoint, data=data, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else []
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _supabase_insert(message):
    result = _supabase_request("POST", None, {
        "id": message["id"],
        "ts": message["ts"],
        "sender": message["sender"],
        "sender_type": message["sender_type"],
        "channel": message["channel"],
        "body": message["body"],
        "reply_to": message["reply_to"],
        "mentions": message["mentions"],
    })
    return result is not None


def _supabase_read(channel, since):
    query = {
        "select": "id,ts,sender,sender_type,channel,body,reply_to,mentions",
        "channel": "eq." + channel,
        "order": "ts.asc",
        "limit": "200",
    }
    if since:
        query["ts"] = "gt." + since
    rows = _supabase_request("GET", query, None)
    if rows is None:
        return None
    cleaned = []
    for row in rows:
        row["mentions"] = row.get("mentions") or []
        cleaned.append(row)
    return cleaned


def _upstream():
    return os.environ.get("HYDI_BOARD_UPSTREAM", "").strip().rstrip("/")


def _upstream_request(method, query, body, authorization):
    base = _upstream()
    if not base:
        return None
    url = base + "/api/board"
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v})
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if authorization:
        req.add_header("Authorization", authorization)
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            parsed = json.loads(exc.read().decode("utf-8"))
        except (json.JSONDecodeError, OSError):
            parsed = {"ok": False, "error": "upstream rejected"}
        parsed["status"] = exc.code
        return parsed
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _normalize_channel(channel):
    value = (channel or "general").strip() or "general"
    if value not in CHANNELS:
        raise BoardError(400, "unknown channel")
    return value


def post_message(authorization, sender_claim, channel, body, reply_to, client_ip):
    if not is_internal_ip(client_ip):
        raise BoardError(404, "not found")
    channel = _normalize_channel(channel)
    text = str(body or "").strip()
    if not text:
        raise BoardError(400, "body required")
    if len(text) > MAX_BODY:
        raise BoardError(400, "body exceeds 4000 characters")

    upstream = _upstream_request(
        "POST",
        None,
        {"sender": sender_claim, "channel": channel, "body": text, "reply_to": reply_to},
        authorization,
    )
    if isinstance(upstream, dict) and upstream.get("ok") and upstream.get("message"):
        _insert_local(upstream["message"])
        return upstream["message"], False
    if isinstance(upstream, dict) and upstream.get("status") in (401, 403, 400, 429):
        raise BoardError(int(upstream["status"]), upstream.get("error") or "rejected")

    ident = identify(authorization)
    if sender_claim and sender_claim != ident["sender"]:
        raise BoardError(403, "sender does not match token")
    if ident["sender_type"] == "agent" and _recent_agent_count(ident["sender"]) >= AGENT_RATE:
        raise BoardError(429, "agent rate limit")

    parent_id = None
    if reply_to:
        parent = _get_local(reply_to)
        if not parent:
            raise BoardError(400, "reply_to not found")
        parent_id = parent["reply_to"] or parent["id"]

    message = {
        "id": str(uuid.uuid4()),
        "ts": _now(),
        "sender": ident["sender"],
        "sender_type": ident["sender_type"],
        "channel": channel,
        "body": text,
        "reply_to": parent_id,
        "mentions": _mentions(text),
    }
    _insert_local(message)
    remote_ok = True
    if _supabase_config():
        remote_ok = _supabase_insert(message)
    offline = bool(_upstream()) or (bool(_supabase_config()) and not remote_ok)
    return message, offline


def read_messages(channel, since, client_ip):
    if not is_internal_ip(client_ip):
        raise BoardError(404, "not found")
    channel = _normalize_channel(channel)
    since = (since or "").strip()
    remote = None
    remote_configured = bool(_upstream() or _supabase_config())
    if _upstream():
        remote_body = _upstream_request("GET", {"channel": channel, "since": since}, None, "")
        if isinstance(remote_body, dict) and remote_body.get("ok"):
            remote = remote_body.get("messages") or []
    elif _supabase_config():
        remote = _supabase_read(channel, since)
    local = sqlite_read(channel, since)
    if remote is None:
        return local, remote_configured
    seen = {row.get("id") for row in remote}
    for row in remote:
        if row.get("id"):
            _insert_local(row)
    extra = [row for row in local if row["id"] not in seen]
    merged = list(remote) + extra
    merged.sort(key=lambda row: row.get("ts") or "")
    return merged, False


def handle_http(payload):
    payload = payload or {}
    client_ip = payload.get("client_ip") or "127.0.0.1"
    try:
        method = str(payload.get("method") or "GET").upper()
        query = payload.get("query") or {}
        if method == "GET":
            messages, offline = read_messages(query.get("channel"), query.get("since"), client_ip)
            body = {"ok": True, "messages": messages, "status": 200}
            if offline:
                body["offline"] = True
            return body
        if method == "POST":
            incoming = payload.get("body") or {}
            message, offline = post_message(
                payload.get("authorization") or "",
                str(incoming.get("sender") or "").strip(),
                incoming.get("channel"),
                incoming.get("body"),
                incoming.get("reply_to") or None,
                client_ip,
            )
            body = {"ok": True, "message": message, "status": 200}
            if offline:
                body["offline"] = True
            return body
        return {"ok": False, "status": 405, "error": "method not allowed"}
    except BoardError as exc:
        return {"ok": False, "status": exc.status, "error": exc.error}
