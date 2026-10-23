#!/usr/bin/env python3
"""End-to-end tests for the HYDI dashboard-status bridge.

Run after a fresh collector push so the bridge has a live snapshot.
"""
import datetime
import hmac
import hashlib
import json
import secrets
import sys
import urllib.request
import urllib.error
from pathlib import Path

SECRET = Path("/mnt/c/Users/Owner/.hydi_status_bridge_secret").read_text().strip()
DASH_TOKEN = Path("/mnt/c/Users/Owner/.hydi_dashboard_token").read_text().strip()
URL = "https://hydi-system.vercel.app/api/dashboard-status"

FAIL = 0
PASS = 0


def assert_test(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"PASS  {name}")
    else:
        FAIL += 1
        print(f"FAIL  {name}  {detail}")


def sign(raw, secret=SECRET):
    return hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest()


def build_payload(ts_offset_minutes=0):
    ts = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=ts_offset_minutes)
    payload = {
        "source": "local-hydi",
        "version": 1,
        "snapshot_id": secrets.token_urlsafe(16),
        "checkedAt": ts.isoformat(),
        "agents": [{"name": "Heidi", "status": "down", "detail": "test", "checkedAt": ts.isoformat()}],
        "pipeline": {"status": "degraded"},
        "supabase": {"status": "down"},
        "infrastructure": {},
        "collector": {"status": "healthy"}
    }
    return payload


def post(payload, secret=SECRET, override_sig=None, override_auth=None):
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(',',':'))
    sig = override_sig or sign(raw, secret)
    body = json.dumps({
        "payload_raw": raw,
        "signature": sig,
        "algorithm": "hmac-sha256",
        "timestamp": payload["checkedAt"]
    }).encode()
    headers = {"Content-Type": "application/json"}
    if override_auth is not None:
        if override_auth:
            headers["Authorization"] = f"Bearer {override_auth}"
    else:
        headers["Authorization"] = f"Bearer {secret}"
    req = urllib.request.Request(URL, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.getcode(), json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode()) if e.fp else {}


def get(token=DASH_TOKEN):
    req = urllib.request.Request(URL, headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.getcode(), json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode()) if e.fp else {}


# 1. missing auth
print("\n--- authentication ---")
code, body = post(build_payload(), override_auth="")
assert_test("missing auth -> 401", code == 401, f"got {code} {body}")

# 2. invalid auth
code, body = post(build_payload(), override_auth="bad-token")
assert_test("invalid auth -> 401", code == 401, f"got {code} {body}")

# 3. fresh valid snapshot
print("\n--- valid snapshot ---")
pl = build_payload()
code, body = post(pl)
assert_test("fresh valid snapshot -> 200", code == 200 and body.get("accepted") is True, f"got {code} {body}")

# 4. bad signature
code, body = post(build_payload(), override_sig="bad-sig")
assert_test("bad signature -> 422", code == 422 and body.get("error") == "Invalid signature", f"got {code} {body}")

# 5. timestamp 29 minutes old
print("\n--- expiration boundary ---")
pl = build_payload(29)
code, body = post(pl)
assert_test("29-minute-old timestamp -> 200", code == 200, f"got {code} {body}")

# 6. timestamp 31 minutes old
pl = build_payload(31)
code, body = post(pl)
assert_test("31-minute-old timestamp -> 422 expired", code == 422 and body.get("error") == "Snapshot expired", f"got {code} {body}")

# 7. replay of accepted snapshot
print("\n--- replay ---")
pl = build_payload()
code, body = post(pl)
assert_test("first use of snapshot_id -> 200", code == 200, f"got {code} {body}")
code, body = post(pl)
assert_test("replay of same snapshot_id -> 422", code == 422 and body.get("error") == "Snapshot replayed", f"got {code} {body}")

# 8. source selection
print("\n--- source selection ---")
code, body = get()
assert_test("Supabase down + fresh bridge -> status_source = local-hydi", body.get("status_source") == "local-hydi", f"got {body.get('status_source')}")

print(f"\nResults: {PASS} passed, {FAIL} failed")
sys.exit(0 if FAIL == 0 else 1)
