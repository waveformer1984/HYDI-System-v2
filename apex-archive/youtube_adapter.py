"""
YouTube publishing scaffolding for Apex Archive -- interfaces and readiness checks
ONLY. This module contains no credentials, no OAuth flow, no API calls, and no
account-creation logic, and it never will by design.

What this file DOES provide, so a real integration is a config change rather than
a pipeline redesign later:
  - check_upload_readiness(): checks a package meets YouTube's structural
    requirements (video present, metadata present, thumbnail present, title/
    description length limits) WITHOUT needing any credentials.
  - build_upload_request(): assembles the request payload a real upload call would
    need (title, description, tags, category, privacy status), from the package's
    own metadata.json -- again, no network call, no credentials.
  - upload(): deliberately raises NotImplementedError. It requires
    APEX_YOUTUBE_CREDENTIALS_PATH to point at owner-supplied OAuth credentials AND
    APEX_YOUTUBE_PUBLISHING_POLICY to be explicitly set to "enabled" -- and even
    then this file does not implement the actual googleapiclient call, because
    building that against invented/absent credentials would be worse than not
    having it. The scheduled task never calls upload(); only a human-invoked,
    separately-authorized action ever could.
"""
import json
import os

MAX_TITLE_LEN = 100
MAX_DESCRIPTION_LEN = 5000
MAX_TAGS = 500  # combined character budget YouTube enforces; checked as a sum below


def check_upload_readiness(package_dir):
    """Structural-only readiness check. Returns (ready: bool, issues: list[str])."""
    issues = []
    video_path = os.path.join(package_dir, "video.mp4")
    thumb_path = os.path.join(package_dir, "thumbnail.png")
    meta_path = os.path.join(package_dir, "metadata.json")

    if not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
        issues.append("video.mp4 missing or empty")
    if not os.path.exists(thumb_path) or os.path.getsize(thumb_path) == 0:
        issues.append("thumbnail.png missing or empty")
    if not os.path.exists(meta_path):
        issues.append("metadata.json missing")
        return False, issues

    with open(meta_path) as f:
        meta = json.load(f)
    title = meta.get("draft_title", "")
    desc = meta.get("draft_description", "")
    tags = meta.get("draft_tags", [])

    if not title:
        issues.append("no draft_title in metadata.json")
    elif len(title) > MAX_TITLE_LEN:
        issues.append(f"draft_title exceeds YouTube's {MAX_TITLE_LEN}-char limit ({len(title)} chars)")
    if len(desc) > MAX_DESCRIPTION_LEN:
        issues.append(f"draft_description exceeds YouTube's {MAX_DESCRIPTION_LEN}-char limit ({len(desc)} chars)")
    if sum(len(t) for t in tags) > MAX_TAGS:
        issues.append(f"combined tag length exceeds YouTube's {MAX_TAGS}-char budget")

    return len(issues) == 0, issues


def build_upload_request(package_dir):
    """Assembles (but does not send) the payload a real upload call would need."""
    with open(os.path.join(package_dir, "metadata.json")) as f:
        meta = json.load(f)
    return {
        "video_path": os.path.join(package_dir, "video.mp4"),
        "thumbnail_path": os.path.join(package_dir, "thumbnail.png"),
        "title": meta.get("draft_title"),
        "description": meta.get("draft_description"),
        "tags": meta.get("draft_tags", []),
        "category_id": "2",  # "Autos & Vehicles" per YouTube's category taxonomy
        "privacy_status": "private",  # never default to public; J changes this deliberately
    }


def upload(package_dir):
    """Never called automatically. Requires explicit owner configuration and is not
    implemented against real credentials by this codebase."""
    creds_path = os.environ.get("APEX_YOUTUBE_CREDENTIALS_PATH")
    policy = os.environ.get("APEX_YOUTUBE_PUBLISHING_POLICY")
    if not creds_path or not os.path.exists(creds_path):
        raise NotImplementedError(
            "YouTube upload is not configured: set APEX_YOUTUBE_CREDENTIALS_PATH to owner-supplied "
            "OAuth credentials. This codebase never creates, invents, or discovers credentials."
        )
    if policy != "enabled":
        raise NotImplementedError(
            "YouTube upload is disabled: set APEX_YOUTUBE_PUBLISHING_POLICY=enabled explicitly to allow it. "
            "This is a deliberate second gate on top of credentials -- having a key configured is not "
            "the same as authorizing automatic publishing."
        )
    raise NotImplementedError(
        "The actual googleapiclient upload call is intentionally not implemented here. "
        "Wire it up only when real credentials and an explicit publishing policy exist; "
        "build_upload_request() already assembles the payload it would need."
    )
