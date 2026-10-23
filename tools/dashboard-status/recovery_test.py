import hmac
import hashlib
import json
import secrets
import urllib.request
import urllib.error
import datetime
from pathlib import Path

SECRET = Path("/mnt/c/Users/Owner/.hydi_status_bridge_secret").read_text().strip()
TOKEN = Path("/mnt/c/Users/Owner/.hydi_dashboard_token").read_text().strip()
URL = "https://hydi-system.vercel.app/api/dashboard-status"


def post(payload):
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(',',':'))
    sig = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    body = json.dumps({"payload_raw": raw, "signature": sig, "algorithm": "hmac-sha256", "timestamp": payload["checkedAt"]}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {SECRET}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.getcode()
    except urllib.error.HTTPError as e:
        return e.code


def get():
    req = urllib.request.Request(URL, headers={"Authorization": f"Bearer {TOKEN}"}, method="GET")
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.getcode(), json.loads(r.read().decode())


def build(age_minutes=0):
    ts = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=age_minutes)
    return {
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


def main():
    print("post fresh:", post(build(0)))
    _, body = get()
    print("source after fresh:", body["status_source"])

    print("post 31-minute expired:", post(build(31)))
    _, body = get()
    print("source after expired rejected:", body["status_source"])

    if body["status_source"] == "local-hydi":
        print("PASS  previous good snapshot retained")
    else:
        print("FAIL  previous good snapshot not retained")


if __name__ == "__main__":
    main()
