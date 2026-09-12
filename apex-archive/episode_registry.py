"""Persistent episode registry -- the cross-run ledger that lets the scheduler
PROVE a topic is genuinely new instead of assuming it. Append-only: existing
records are never deleted or overwritten by normal operation.

File format: a single JSON array of episode records at REGISTRY_PATH, kept
alongside the rest of the pipeline files so it survives across weekly runs.
If the file is missing, this is treated as "first run ever" -- not an error.
"""
import difflib
import hashlib
import json
import os
import re
from datetime import datetime, timezone

REGISTRY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "episode_registry.json")
TOPIC_COOLDOWN_RUNS = 6          # a topic_slug shouldn't repeat within this many runs
NEAR_DUP_TITLE_RATIO = 0.85      # difflib ratio above which two titles are "near-duplicate"
SOURCE_CLUSTER_OVERLAP = 0.6     # fraction of shared source domains that counts as a repeated cluster


def _now():
    return datetime.now(timezone.utc).isoformat()


def slugify(text):
    text = (text or "").lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


def make_episode_id(title):
    h = hashlib.sha256(f"{title}|{_now()}".encode("utf-8")).hexdigest()[:8]
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"{date}-{slugify(title)}-{h}"


def load_registry():
    if not os.path.exists(REGISTRY_PATH):
        return []
    try:
        with open(REGISTRY_PATH) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        # A corrupt registry must never crash production. Treat as empty but
        # preserve the corrupt file for forensics rather than deleting it.
        corrupt_path = REGISTRY_PATH + f".corrupt-{int(datetime.now().timestamp())}"
        try:
            os.rename(REGISTRY_PATH, corrupt_path)
        except OSError:
            pass
        return []


def save_registry(records):
    tmp = REGISTRY_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(records, f, indent=2)
    os.replace(tmp, REGISTRY_PATH)  # atomic on POSIX -- never leaves a half-written registry


def _domain(url):
    m = re.match(r"https?://([^/]+)/?", url or "")
    return m.group(1).lower() if m else (url or "")


def check_topic_available(topic_slug, pillar, registry=None):
    """Returns (available: bool, reason: str). Does not mutate the registry."""
    records = registry if registry is not None else load_registry()
    recent = [r for r in records if r.get("pillar") == pillar][-TOPIC_COOLDOWN_RUNS:]
    for r in recent:
        if r.get("topic_slug") == topic_slug:
            return False, (f"topic_slug '{topic_slug}' was used within the last {TOPIC_COOLDOWN_RUNS} "
                            f"{pillar} episodes (episode_id={r.get('episode_id')})")
    return True, ""


def check_duplicates(episode_id, title, script_sha256, source_urls, registry=None):
    """Hard-duplicate + near-duplicate checks against everything ever produced.
    Returns a list of finding dicts; empty list means clean."""
    records = registry if registry is not None else load_registry()
    findings = []

    if any(r.get("episode_id") == episode_id for r in records):
        findings.append({"type": "duplicate_episode_id", "severity": "blocking", "detail": episode_id})

    if script_sha256 and any(r.get("script_sha256") == script_sha256 for r in records):
        findings.append({"type": "duplicate_script_hash", "severity": "blocking", "detail": script_sha256})

    norm_title = slugify(title)
    for r in records:
        if slugify(r.get("title", "")) == norm_title:
            findings.append({"type": "duplicate_title", "severity": "blocking", "detail": r.get("episode_id")})

    for r in records:
        ratio = difflib.SequenceMatcher(None, norm_title, slugify(r.get("title", ""))).ratio()
        if ratio >= NEAR_DUP_TITLE_RATIO and slugify(r.get("title", "")) != norm_title:
            findings.append({"type": "near_duplicate_title", "severity": "advisory",
                              "detail": f"{r.get('episode_id')} (similarity={ratio:.2f})"})

    src_domains = {_domain(u) for u in (source_urls or [])}
    if src_domains:
        for r in records:
            prior_domains = set(r.get("source_domains", []))
            if not prior_domains:
                continue
            overlap = len(src_domains & prior_domains) / max(len(src_domains | prior_domains), 1)
            if overlap >= SOURCE_CLUSTER_OVERLAP:
                findings.append({"type": "repeated_source_cluster", "severity": "advisory",
                                  "detail": f"{r.get('episode_id')} (overlap={overlap:.2f})"})

    return findings


def register_episode(episode_id, title, topic_slug, pillar, script_sha256, source_urls, status,
                      manifest_path, imported=False):
    records = load_registry()
    records.append({
        "episode_id": episode_id,
        "title": title,
        "topic_slug": topic_slug,
        "pillar": pillar,
        "script_sha256": script_sha256,
        "source_domains": sorted({_domain(u) for u in (source_urls or [])}),
        "status": status,
        "generated_at": _now(),
        "published_at": None,
        "manifest_path": os.path.abspath(manifest_path),
        "imported": imported,  # True only for records backfilled from pre-registry history
    })
    save_registry(records)
    return records[-1]


def update_status(episode_id, new_status, published_at=None):
    records = load_registry()
    found = False
    for r in records:
        if r.get("episode_id") == episode_id:
            r["status"] = new_status
            if published_at:
                r["published_at"] = published_at
            found = True
            break
    if not found:
        raise ValueError(f"episode_id {episode_id} not found in registry -- cannot update status")
    save_registry(records)
    return found
