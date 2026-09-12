"""
HYDI integration adapter for Apex Archive -- DRAFT CONTRACT, not a live integration,
strictly one-way and non-authoritative: HYDI can observe Apex Archive's state, and
NOTHING in this codebase gives HYDI, Ursula, HEIDI, CASCADE, or any other external
system a path to approve, publish, or otherwise mutate Apex Archive's state machine.
There is no inbound handler, no polling of a HYDI command endpoint, nothing that
reads a HYDI response and acts on it. Do not add one.

HYDI is not reachable from this task's sandbox: it runs on J's local WSL2 machine
and, as of the last known qualification status, v1.0 is still mid-certification.
This module never assumes a live connection.

Every event is always written to a local outbox as a JSON file. It is additionally
POSTed to a real HYDI endpoint ONLY if the HYDI_BRIDGE_URL environment variable is
set. Any network failure is caught and reported as non-fatal.

Event catalog (all one-way, Apex Archive -> HYDI):
  project_status      revenue/project tracking snapshot
  orchestration_ping  lets a future Ursula/CASCADE integration discover this pipeline
  episode_generated   fired once GENERATED is reached (raw render produced)
  episode_verified    fired once VERIFIED is reached (independent verification passed)
  approval_event      mirrors manifest.py's human-only state transitions
  publication_event   fired on PUBLISHED
  analytics_event     fired on ANALYZED (only ever carries real or NOT_CONNECTED data)
  failure_event       fired when a gate blocks the run, for observability
"""
import json
import os
import time
import urllib.error
import urllib.request

OUTBOX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hydi_outbox")
HYDI_BRIDGE_URL = os.environ.get("HYDI_BRIDGE_URL")  # unset by default -- e.g. http://127.0.0.1:5050/events
PROJECT_ID = "apex-archive"
SCHEMA_VERSION = "draft-2"


def _write_local(event):
    os.makedirs(OUTBOX_DIR, exist_ok=True)
    fname = f"{int(time.time() * 1000)}_{event['event_type']}.json"
    path = os.path.join(OUTBOX_DIR, fname)
    with open(path, "w") as f:
        json.dump(event, f, indent=2)
    return path


def _post(event):
    if not HYDI_BRIDGE_URL:
        return {"sent": False, "reason": "HYDI_BRIDGE_URL not configured -- local-only"}
    try:
        data = json.dumps(event).encode("utf-8")
        req = urllib.request.Request(HYDI_BRIDGE_URL, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {"sent": resp.status < 300, "status": resp.status}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return {"sent": False, "reason": str(e)}


def emit(event_type, payload):
    event = {
        "project_id": PROJECT_ID,
        "event_type": event_type,
        "emitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "schema_version": SCHEMA_VERSION,
        "payload": payload,
    }
    local_path = _write_local(event)
    delivery = _post(event)
    event["_delivery"] = {"local_path": local_path, **delivery}
    return event


def project_status(manifest):
    return emit("project_status", {
        "project_name": "Apex Archive",
        "project_type": "faceless_youtube_channel",
        "vertical": "motorsport_history",
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "state": manifest.get("state"),
        "pillar": manifest.get("pillar"),
        "needs_manual_review": manifest.get("needs_manual_review"),
        "revenue_status": "pre_launch",
        "pipeline_version": manifest.get("pipeline_version"),
    })


def orchestration_ping(manifest):
    return emit("orchestration_ping", {
        "pipeline_id": "apex-archive-weekly-episode",
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "owner": "scheduled-task",
        "claimable": True,
        "current_episode_state": manifest.get("state"),
        "next_action_needed": "human_review" if manifest.get("state") == "HUMAN_REVIEW" else None,
    })


def episode_generated(manifest):
    return emit("episode_generated", {
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "tts_provider": manifest.get("tts_provider"),
    })


def episode_verified(manifest, verify_summary):
    return emit("episode_verified", {
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "checks_passed": verify_summary.get("n_pass"),
        "checks_total": verify_summary.get("n_total"),
    })


def approval_event(manifest, transition, actor):
    return emit("approval_event", {
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "transition": transition,
        "actor": actor,
        "state": manifest.get("state"),
        "approved_by": manifest.get("approved_by"),
        "approved_at": manifest.get("approved_at"),
    })


def publication_event(manifest):
    return emit("publication_event", {
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "published_url": manifest.get("published_url"),
        "published_at": manifest.get("published_at"),
    })


def analytics_event(manifest, analytics_record):
    return emit("analytics_event", {
        "episode_id": manifest.get("episode_id"),
        "episode_title": manifest.get("title"),
        "status": analytics_record.get("status"),  # "NOT_CONNECTED" or "CONNECTED" -- never fabricated
    })


def failure_event(episode_id_or_none, stage, reason):
    return emit("failure_event", {
        "episode_id": episode_id_or_none,
        "stage": stage,
        "reason": str(reason)[:500],
    })
