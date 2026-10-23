#!/usr/bin/env python3
r"""
HYDI local status collector.

Collects real local HYDI operational status, signs it with HMAC-SHA256,
and uploads it to the Vercel dashboard-status bridge.

Reads HYDI_STATUS_BRIDGE_SECRET from C:\Users\Owner\.hydi_status_bridge_secret.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SECRET_PATH = Path("/mnt/c/Users/Owner/.hydi_status_bridge_secret")
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_JSON = CACHE_DIR / "hydi-status.json"
INGEST_URL = "https://hydi-system.vercel.app/api/dashboard-status"
LOCAL_BASE = "http://localhost:3001"
CLOUD_SUPABASE = "https://akbnfovjdcobifeupvbn.supabase.co"


def load_secret():
    if not SECRET_PATH.exists():
        raise FileNotFoundError(f"Bridge secret file not found: {SECRET_PATH}")
    return SECRET_PATH.read_text().strip()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def http_get_json(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}


def http_post_json(url, data, timeout=10):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode("utf-8")}
    except Exception as e:
        return {"error": str(e)}


def classify_agent_status(data, name):
    if "error" in data:
        return {"name": name, "status": "unknown", "detail": data["error"], "checkedAt": now_iso()}
    if name == "Heidi":
        if data.get("available"):
            return {"name": name, "status": "healthy", "detail": "local model available", "checkedAt": now_iso()}
        if data.get("initialized"):
            return {"name": name, "status": "degraded", "detail": data.get("initError", "model not available"), "checkedAt": now_iso()}
        return {"name": name, "status": "down", "detail": data.get("initError", "not initialized"), "checkedAt": now_iso()}
    if name == "Ursula":
        ursula = data.get("ursula", {})
        raw = str(ursula.get("status", data.get("status", "UNKNOWN"))).lower()
        detail = ursula.get("message", data.get("message", "no detail"))
        status = "unknown"
        if raw in ("ok", "healthy"):
            status = "healthy"
        elif raw in ("warning", "degraded"):
            status = "degraded"
        elif raw in ("critical", "error", "down"):
            status = "down"
        return {"name": name, "status": status, "detail": detail, "checkedAt": now_iso()}
    return {"name": name, "status": "unknown", "detail": "no dedicated local health endpoint", "checkedAt": now_iso()}


def get_pipeline_status():
    data = http_get_json(f"{LOCAL_BASE}/api/health", timeout=15)
    if "error" in data:
        return {"status": "unknown", "current_status": "unknown", "detail": data["error"]}
    raw = data.get("status", "unknown").lower()
    status = raw if raw in ("healthy", "degraded", "down", "unknown") else "unknown"
    return {
        "status": status,
        "current_status": data.get("hydi_status") or data.get("current_status") or "unknown",
        "detail": data.get("trend_reason") or data.get("escalation_reason") or "no detail",
        "checkedAt": now_iso()
    }


def get_supabase_status():
    mode = os.environ.get("HYDI_PERSISTENCE_MODE", "local").lower()
    if mode in ("local", "auto"):
        # Local Supabase API connectivity (Kong/PostgREST)
        try:
            urllib.request.urlopen("http://127.0.0.1:54321", timeout=10)
            return {"status": "healthy", "detail": "local Supabase reachable"}
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 404):
                return {"status": "healthy", "detail": "local Supabase reachable (auth required)"}
            return {"status": "degraded", "detail": f"LOCAL_SUPABASE_HTTP_{e.code}"}
        except Exception as e:
            return {"status": "down", "detail": f"LOCAL_SUPABASE_NETWORK_ERROR: {type(e).__name__}"}

    # Cloud Supabase connectivity
    try:
        urllib.request.urlopen(CLOUD_SUPABASE, timeout=10)
        return {"status": "unknown", "detail": "cloud Supabase unexpectedly reachable"}
    except Exception as e:
        return {"status": "down", "detail": f"SUPABASE_NETWORK_ERROR: {type(e).__name__}"}


def get_infrastructure():
    infra = {}
    try:
        result = subprocess.run(["docker", "ps", "--format", "{{.Names}}:{{.Status}}"], capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if ":" in line:
                    name, status = line.split(":", 1)
                    infra[name] = "healthy" if "healthy" in status.lower() or "up" in status.lower() else "degraded"
        else:
            infra["docker"] = "unknown"
    except Exception as e:
        infra["docker"] = f"unknown: {e}"
    return infra


def sign_payload(payload, secret):
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(',',':'))
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return signature


def build_snapshot():
    heidi = http_post_json(f"{LOCAL_BASE}/api/heidi", {"action": "status"}, timeout=10)
    ursula = http_get_json(f"{LOCAL_BASE}/api/ursula/status", timeout=20)

    agents = [
        classify_agent_status(heidi, "Heidi"),
        classify_agent_status(ursula, "Ursula"),
        {"name": "CASCADE", "status": "unknown", "detail": "no dedicated local health endpoint", "checkedAt": now_iso()},
        {"name": "KILO", "status": "unknown", "detail": "no dedicated local health endpoint", "checkedAt": now_iso()},
        {"name": "ProtoForge", "status": "unknown", "detail": "no dedicated local health endpoint", "checkedAt": now_iso()},
        {"name": "Hyve", "status": "unknown", "detail": "no dedicated local health endpoint", "checkedAt": now_iso()},
    ]

    pipeline = get_pipeline_status()
    supabase = get_supabase_status()
    infrastructure = get_infrastructure()

    payload = {
        "source": "local-hydi",
        "version": 1,
        "snapshot_id": secrets.token_urlsafe(16),
        "checkedAt": now_iso(),
        "agents": agents,
        "pipeline": pipeline,
        "supabase": supabase,
        "infrastructure": infrastructure,
        "collector": {"status": "healthy"}
    }
    return payload


def upload_snapshot(payload, secret):
    payload_raw = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(',',':'))
    signature = hmac.new(secret.encode("utf-8"), payload_raw.encode("utf-8"), hashlib.sha256).hexdigest()
    envelope = {
        "payload_raw": payload_raw,
        "payload": payload,
        "signature": signature,
        "algorithm": "hmac-sha256",
        "timestamp": payload["checkedAt"]
    }

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_JSON.write_text(json.dumps(envelope, indent=2))

    body = {
        "payload_raw": payload_raw,
        "payload": payload,
        "signature": signature,
        "algorithm": "hmac-sha256",
        "timestamp": payload["checkedAt"]
    }
    req = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode("utf-8")}
    except Exception as e:
        return {"error": str(e)}


def main():
    secret = load_secret()
    payload = build_snapshot()
    result = upload_snapshot(payload, secret)
    print(json.dumps({
        "checkedAt": payload["checkedAt"],
        "uploaded": "error" not in result,
        "result": result,
        "status_source": payload["source"],
        "agents": [a["status"] for a in payload["agents"]],
        "pipeline": payload["pipeline"]["status"],
        "supabase": payload["supabase"]["status"]
    }, indent=2))


if __name__ == "__main__":
    main()
