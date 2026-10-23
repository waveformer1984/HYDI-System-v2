#!/usr/bin/env python3
r"""
HYDI Dashboard 5-minute poller.

Reads the bearer token from C:\Users\Owner\.hydi_dashboard_token (server-side file).
Fetches https://hydi-system.vercel.app/api/dashboard-status.
Writes a JSON cache and a JS-snippet for the dashboard artifact.
"""
import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://hydi-system.vercel.app/api/dashboard-status"
TOKEN_PATH = Path("/mnt/c/Users/Owner/.hydi_dashboard_token")
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_JSON = CACHE_DIR / "status-cache.json"
POLL_LOG = CACHE_DIR / "poll-log.jsonl"
DASHBOARD_JS = Path("/mnt/c/Users/Owner/HYDI_System/dashboard/status-data.js")
TIMEOUT_SECONDS = 25

REQUIRED_FIELDS = {"agents", "supabase", "pipeline", "checkedAt"}


def load_token():
    if not TOKEN_PATH.exists():
        raise FileNotFoundError(f"Token file not found: {TOKEN_PATH}")
    return TOKEN_PATH.read_text().strip()


def classify_failure(err):
    if isinstance(err, urllib.error.URLError):
        reason = str(err.reason)
        if "getaddrinfo" in reason or "Name or service not known" in reason:
            return "DNS"
        if "Connection refused" in reason:
            return "NETWORK_REFUSED"
        if "timed out" in reason or "timeout" in reason.lower():
            return "NETWORK_TIMEOUT"
        return "NETWORK"
    if isinstance(err, urllib.error.HTTPError):
        if err.code == 401:
            return "AUTH"
        if err.code == 405:
            return "METHOD_NOT_ALLOWED"
        if err.code >= 500:
            return "API_ERROR"
        return f"HTTP_{err.code}"
    if isinstance(err, json.JSONDecodeError):
        return "MALFORMED_JSON"
    return "UNKNOWN"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_cache():
    if CACHE_JSON.exists():
        try:
            return json.loads(CACHE_JSON.read_text())
        except Exception:
            return None
    return None


def save_cache(state):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_JSON.write_text(json.dumps(state, indent=2))
    js = "window.HYDI_STATUS = " + json.dumps(state, indent=2) + ";\n"
    DASHBOARD_JS.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD_JS.write_text(js)


def append_log(entry):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(POLL_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def main():
    token = load_token()
    previous = load_cache()

    request = urllib.request.Request(
        ENDPOINT,
        method="GET",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )

    start = time.time()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            elapsed_ms = int((time.time() - start) * 1000)
            status = response.getcode()
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        elapsed_ms = int((time.time() - start) * 1000)
        status = e.code
        body = e.read().decode("utf-8") if e.fp else ""
    except urllib.error.URLError as e:
        elapsed_ms = int((time.time() - start) * 1000)
        status = 0
        body = str(e.reason)
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        status = 0
        body = str(e)

    checked_at = now_iso()
    log_entry = {
        "checked_at": checked_at,
        "status": status,
        "ms": elapsed_ms,
        "body_preview": body[:200],
    }

    if status != 200:
        log_entry["failure"] = classify_failure(Exception(body) if not status else urllib.error.HTTPError(None, status, None, None, None))
        append_log(log_entry)
        if previous:
            previous["last_checked"] = checked_at
            previous["last_failure"] = checked_at
            previous["failure_count"] = previous.get("failure_count", 0) + 1
            previous["status"] = "stale" if previous["status"] == "live" else previous["status"]
            save_cache(previous)
        return

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        log_entry["failure"] = "MALFORMED_JSON"
        append_log(log_entry)
        if previous:
            previous["last_checked"] = checked_at
            previous["last_failure"] = checked_at
            previous["failure_count"] = previous.get("failure_count", 0) + 1
            previous["status"] = "stale"
            save_cache(previous)
        return

    if not REQUIRED_FIELDS.issubset(payload.keys()):
        log_entry["failure"] = "SCHEMA_MISSING_FIELDS"
        append_log(log_entry)
        if previous:
            previous["last_checked"] = checked_at
            previous["last_failure"] = checked_at
            previous["failure_count"] = previous.get("failure_count", 0) + 1
            previous["status"] = "stale"
            save_cache(previous)
        return

    state = {
        "status": "live",
        "last_checked": checked_at,
        "last_success": checked_at,
        "last_failure": None,
        "failure_count": 0,
        "payload": payload,
    }

    log_entry["success"] = True
    append_log(log_entry)
    save_cache(state)


if __name__ == "__main__":
    main()
