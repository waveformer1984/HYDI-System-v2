"""
Analytics architecture for Apex Archive -- schema and ingestion interface only.

There is no YouTube channel yet, so there is no real analytics data. This module
NEVER fabricates numbers. ingest_analytics() with no real source returns a record
whose status is explicitly "NOT_CONNECTED" and whose metric fields are all None --
never zero, never a plausible-looking placeholder, since either of those could be
mistaken for real data downstream.

mark_analyzed() is the only function that can move a manifest from PUBLISHED to
ANALYZED, and it is never called by the scheduled task -- only by an operator (J,
or Claude acting on J's explicit instruction in a live session) once the episode
has actually been live long enough to have real numbers, or explicitly with a
NOT_CONNECTED record if J wants the state machine to reflect "nothing to analyze
yet" without inventing data.
"""
from datetime import datetime, timezone

import manifest as manifest_mod

METRIC_FIELDS = [
    "impressions", "ctr", "views", "watch_time_minutes", "avg_view_duration_s",
    "avg_percentage_viewed", "retention_curve", "first_30s_retention",
    "subscriber_conversion", "returning_viewers", "shorts_viewed_vs_swiped_away",
    "traffic_source", "publication_date", "episode_type", "title", "thumbnail_ref",
    "topic", "duration_s",
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def not_connected_record(manifest):
    """The honest default: no channel, no data, explicitly marked as such."""
    record = {field: None for field in METRIC_FIELDS}
    record.update({
        "status": "NOT_CONNECTED",
        "reason": "no live YouTube channel / Analytics API connection configured",
        "episode_type": f"{manifest.get('format')}/{manifest.get('pillar')}",
        "title": manifest.get("title"),
        "topic": manifest.get("topic_slug"),
        "recorded_at": _now(),
    })
    return record


def ingest_analytics(manifest, real_metrics=None):
    """real_metrics, if provided, must be a dict of actual values pulled from the
    real YouTube Analytics API by the operator -- this function does not fetch
    anything itself (no credentials, no API calls; see youtube_adapter.py for why).
    Any field not present in real_metrics stays None rather than being guessed."""
    if real_metrics is None:
        return not_connected_record(manifest)
    record = {field: real_metrics.get(field) for field in METRIC_FIELDS}
    record["status"] = "CONNECTED"
    record["recorded_at"] = _now()
    return record


def mark_analyzed(manifest, analytics_record, by):
    """PUBLISHED -> ANALYZED. Requires an analytics_record with an explicit status
    (from ingest_analytics/not_connected_record above) -- refuses ad-hoc dicts that
    skip the fabrication guard."""
    if manifest.get("state") != "PUBLISHED":
        raise manifest_mod.StateError(
            f"cannot mark ANALYZED: manifest is in {manifest.get('state')}, must be PUBLISHED first"
        )
    if not isinstance(analytics_record, dict) or "status" not in analytics_record:
        raise manifest_mod.StateError("analytics_record must come from ingest_analytics() or not_connected_record()")
    manifest["analytics"] = analytics_record
    manifest["analyzed_at"] = _now()
    return manifest_mod._advance(manifest, "ANALYZED", by, f"analytics status={analytics_record['status']}", actor_type="human")
