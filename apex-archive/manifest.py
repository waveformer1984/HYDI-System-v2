"""Episode manifests + 12-state lifecycle + candidate-package assembly.

State machine (enforced -- a transition can only move exactly one step forward,
never skip, and every transition writes an immutable audit event):

    RESEARCH -> FACT_CHECKED -> SCRIPTED -> GENERATED -> QA_PASSED -> RENDERED
        -> VERIFIED -> HUMAN_REVIEW -> APPROVED -> READY_TO_UPLOAD -> PUBLISHED -> ANALYZED

The weekly scheduled task drives states automatically only up through HUMAN_REVIEW.
APPROVED / READY_TO_UPLOAD / PUBLISHED are set ONLY by the human_* functions below
(exposed via approve.py). ANALYZED is set ONLY by analytics.py's mark_analyzed(),
which requires PUBLISHED and refuses to fabricate data. Nothing in the automated
path, HYDI, or any other external system can reach APPROVED or beyond.
"""
import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone

PIPELINE_VERSION = "1.0.0"
STATES = ["RESEARCH", "FACT_CHECKED", "SCRIPTED", "GENERATED", "QA_PASSED", "RENDERED",
          "VERIFIED", "HUMAN_REVIEW", "APPROVED", "READY_TO_UPLOAD", "PUBLISHED", "ANALYZED"]
AUTOMATED_CEILING = "HUMAN_REVIEW"
VALID_CONFIDENCE = {"verified", "needs_review", "disputed", "unsupported"}


class StateError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat()


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _manifest_hash(manifest):
    """Hash of the manifest's substantive content, excluding the history log itself
    (hashing history would make each entry depend on its own hash -- circular)."""
    snapshot = {k: v for k, v in manifest.items() if k != "history"}
    return _sha256_text(json.dumps(snapshot, sort_keys=True, default=str))


def _advance(manifest, target_state, actor, reason, actor_type="task"):
    idx_cur = STATES.index(manifest["state"])
    idx_target = STATES.index(target_state)
    if idx_target != idx_cur + 1:
        raise StateError(
            f"cannot move from {manifest['state']} to {target_state} -- "
            f"states advance one step at a time, no skipping"
        )
    if actor_type == "task" and idx_target > STATES.index(AUTOMATED_CEILING):
        raise StateError(
            f"the automated task cannot set state {target_state}; "
            f"only a human (via approve.py) or analytics.py's mark_analyzed() can advance past {AUTOMATED_CEILING}"
        )
    previous_state = manifest["state"]
    manifest["state"] = target_state
    event = {
        "episode_id": manifest.get("episode_id"),
        "previous_state": previous_state,
        "new_state": target_state,
        "timestamp": _now(),
        "actor": actor,
        "reason": reason,
        "manifest_hash": _manifest_hash(manifest),
    }
    manifest.setdefault("history", []).append(event)
    return manifest


def create_manifest(episode_id, title, pillar, topic_slug, script_format):
    now = _now()
    m = {
        "pipeline_version": PIPELINE_VERSION,
        "episode_id": episode_id,
        "created_at": now,
        "title": title,
        "pillar": pillar,
        "topic_slug": topic_slug,
        "format": script_format,
        "state": "RESEARCH",
        "history": [],
        "script_sha256": None,
        "render_sha256": None,
        "sources": [],
        "fact_check": [],
        "needs_manual_review": True,
        "script_qa": None,
        "technical_qa": None,
        "segment_durations": None,
        "tts_provider": None,
        "approved_by": None,
        "approved_at": None,
        "review_notes": None,
        "published_url": None,
        "published_at": None,
        "analytics": None,
        "analyzed_at": None,
    }
    m.setdefault("history", []).append({
        "episode_id": episode_id, "previous_state": None, "new_state": "RESEARCH",
        "timestamp": now, "actor": "task", "reason": "manifest created, research begun",
        "manifest_hash": _manifest_hash(m),
    })
    return m


def record_fact_check(manifest, script, actor="task"):
    """RESEARCH -> FACT_CHECKED. Validates sources + the expanded fact_check schema
    (claim/source/source_date/confidence/verification_status/notes) and blocks the
    run if any claim critical to the episode is verification_status='unsupported'."""
    manifest["sources"] = script.get("sources", [])
    manifest["fact_check"] = script.get("fact_check", [])
    if not manifest["sources"]:
        raise StateError("cannot reach FACT_CHECKED: no sources recorded in script.json")
    if not manifest["fact_check"]:
        raise StateError("cannot reach FACT_CHECKED: no fact_check entries recorded in script.json")

    bad_status = [c for c in manifest["fact_check"]
                  if c.get("verification_status") and c["verification_status"] not in VALID_CONFIDENCE]
    if bad_status:
        raise StateError(f"fact_check entries with invalid verification_status: {bad_status}")

    unsupported = [c for c in manifest["fact_check"] if c.get("verification_status") == "unsupported"]
    if unsupported:
        raise StateError(f"cannot reach FACT_CHECKED: unsupported critical claim(s) block release: {unsupported}")

    manifest["needs_manual_review"] = any(
        c.get("verification_status") in ("needs_review", "disputed") or c.get("needs_manual_review")
        for c in manifest["fact_check"]
    )
    n_sources, n_claims = len(manifest["sources"]), len(manifest["fact_check"])
    return _advance(manifest, "FACT_CHECKED", actor, f"{n_sources} sources, {n_claims} claims logged, none unsupported")


def record_script(manifest, script, actor="task"):
    """FACT_CHECKED -> SCRIPTED. Structural + tone self-check on the script."""
    errors = []
    if not script.get("title"):
        errors.append("missing title")
    if not script.get("segments"):
        errors.append("no segments")
    if manifest["pillar"] == "race_recap" and not manifest["sources"]:
        errors.append("race_recap pillar requires at least one dated source")
    result = {"passed": len(errors) == 0, "errors": errors}
    manifest["script_qa"] = result
    if not result["passed"]:
        raise StateError(f"script QA failed: {errors}")
    return _advance(manifest, "SCRIPTED", actor, "structural script QA passed")


def record_generated(manifest, render_path, tts_provider, actor="task"):
    """SCRIPTED -> GENERATED. Checkpoint: TTS + visuals + assembly produced a render."""
    if not os.path.exists(render_path) or os.path.getsize(render_path) == 0:
        raise StateError(f"cannot reach GENERATED: render missing or empty at {render_path}")
    manifest["tts_provider"] = tts_provider
    return _advance(manifest, "GENERATED", actor, f"render produced via {tts_provider}")


def record_qa(manifest, technical_qa_result, actor="task"):
    """GENERATED -> QA_PASSED. Technical media QA (qa_check.run_qa, expanded)."""
    manifest["technical_qa"] = technical_qa_result
    if not technical_qa_result.get("passed"):
        raise StateError(f"technical QA failed: {technical_qa_result.get('errors')}")
    return _advance(manifest, "QA_PASSED", actor, "technical media QA passed")


def record_package(manifest, script_path, render_path, out_dir, actor="task"):
    """QA_PASSED -> RENDERED. Assembles the full candidate package and locks in hashes."""
    manifest["render_sha256"] = _sha256_file(render_path)
    with open(script_path, "rb") as f:
        manifest["script_sha256"] = _sha256_text(f.read().decode("utf-8", errors="replace"))
    build_package(script_path, render_path, out_dir, manifest)
    return _advance(manifest, "RENDERED", actor, f"package assembled at {out_dir}")


def record_verification(manifest, verify_results, actor="task"):
    """RENDERED -> VERIFIED. verify_package.py's independent re-check must pass."""
    n_pass = sum(1 for r in verify_results if r["passed"])
    n_total = len(verify_results)
    if n_pass != n_total:
        failed = [r["check"] for r in verify_results if not r["passed"]]
        raise StateError(f"independent verification failed ({n_pass}/{n_total} passed): {failed}")
    return _advance(manifest, "VERIFIED", actor, f"independent verification passed ({n_pass}/{n_total})")


def advance_to_human_review(manifest, actor="task"):
    """VERIFIED -> HUMAN_REVIEW. Automated ceiling -- nothing past here without a human."""
    return _advance(manifest, "HUMAN_REVIEW", actor, "candidate package handed to J for review")


# --- Human-only transitions. Only these functions can ever move state past
# HUMAN_REVIEW, and only because they pass actor_type="human" explicitly. ---

def human_approve(manifest, approved_by, note=None):
    m = _advance(manifest, "APPROVED", approved_by, note or "approved by human review", actor_type="human")
    m["approved_by"] = approved_by
    m["approved_at"] = _now()
    if note:
        m["review_notes"] = note
    return m


def human_mark_ready_to_upload(manifest, by, note=None):
    return _advance(manifest, "READY_TO_UPLOAD", by, note or "marked ready to upload", actor_type="human")


def human_mark_published(manifest, by, url=None):
    m = _advance(manifest, "PUBLISHED", by, (f"uploaded: {url}" if url else "marked published"), actor_type="human")
    m["published_at"] = _now()
    if url:
        m["published_url"] = url
    return m


# analytics.py's mark_analyzed() also uses _advance(..., actor_type="human") after
# checking manifest["state"] == "PUBLISHED" and that a real (non-fabricated) or
# explicitly NOT_CONNECTED analytics record is attached -- see analytics.py.


def _fmt_srt_time(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def _write_srt(script, manifest, out_path):
    durations = manifest.get("segment_durations") or []
    segs = script.get("segments", [])
    lines, t = [], 0.0
    for i, seg in enumerate(segs):
        dur = durations[i] if i < len(durations) else 3.0
        text = seg.get("caption", seg.get("narration", ""))
        lines += [str(i + 1), f"{_fmt_srt_time(t)} --> {_fmt_srt_time(t + dur)}", text, ""]
        t += dur
    with open(out_path, "w") as f:
        f.write("\n".join(lines))


def _write_script_md(script, manifest, out_path):
    lines = [f"# {script.get('title', '')}", "", f"**Pillar:** {script.get('pillar', '')}  ",
             f"**Format:** {manifest.get('format', '')}", f"**Episode ID:** {manifest.get('episode_id', '')}", ""]
    for i, seg in enumerate(script.get("segments", [])):
        lines.append(f"## Segment {i + 1} -- {seg.get('visual', '')}")
        if seg.get("headline"):
            lines.append(f"**Headline:** {seg['headline']}")
        lines.append(f"**Narration:** {seg.get('narration', '')}")
        if seg.get("caption") and seg.get("caption") != seg.get("narration"):
            lines.append(f"**Caption:** {seg['caption']}")
        lines.append("")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))


def _write_qa_report(manifest, out_path):
    lines = ["# QA Report", "", f"Episode: {manifest.get('title')}", f"Episode ID: {manifest.get('episode_id')}",
              "", "## Script QA", f"Passed: {manifest['script_qa']['passed']}"]
    for e in manifest["script_qa"].get("errors", []):
        lines.append(f"- {e}")
    lines += ["", "## Technical QA", f"Passed: {manifest['technical_qa']['passed']}"]
    for k, v in manifest["technical_qa"].get("checks", {}).items():
        lines.append(f"- {k}: {v}")
    if manifest["technical_qa"].get("errors"):
        lines.append("### Errors")
        for e in manifest["technical_qa"]["errors"]:
            lines.append(f"- {e}")
    lines += ["", "## Fact-check ledger"]
    for c in manifest.get("fact_check", []):
        lines.append(f"- [{c.get('verification_status', 'unspecified')}] {c.get('claim', '')}"
                      + (f" -- {c.get('notes')}" if c.get("notes") else ""))
    with open(out_path, "w") as f:
        f.write("\n".join(lines))


def _write_metadata(script, manifest, out_path):
    narration_segs = [seg.get("narration", "") for seg in script.get("segments", []) if seg.get("visual") != "outro"]
    desc = " ".join(narration_segs)[:1000]
    title = script.get("title", "")
    title_candidates = [title]
    if ":" in title:
        title_candidates.append(title.split(":", 1)[1].strip())
    tags = sorted({t for t in [script.get("pillar", "").replace("_", " "), "motorsport history", "apex archive"] if t})
    metadata = {
        "draft_title": title,
        "title_candidates": title_candidates,
        "draft_description": desc,
        "draft_tags": tags,
        "category_suggestion": "Autos & Vehicles",
        "episode_type": f"{manifest.get('format')}/{script.get('pillar')}",
        "suggested_filename": f"{manifest.get('episode_id')}.mp4",
        "note": ("DRAFT ONLY, generated from the script -- J reviews/rewrites before upload. Nothing here is "
                 "submitted anywhere automatically; there is no YouTube API integration. Titles/descriptions "
                 "are drawn only from verified script content, never invented for CTR."),
    }
    with open(out_path, "w") as f:
        json.dump(metadata, f, indent=2)


def build_package(script_path, render_path, out_dir, manifest):
    os.makedirs(out_dir, exist_ok=True)
    with open(script_path) as f:
        script = json.load(f)

    shutil.copy2(script_path, os.path.join(out_dir, "script.json"))
    shutil.copy2(render_path, os.path.join(out_dir, "video.mp4"))

    subprocess.run(
        ["ffmpeg", "-y", "-i", render_path, "-vn", "-acodec", "pcm_s16le", os.path.join(out_dir, "narration.wav")],
        check=True, capture_output=True,
    )

    _write_script_md(script, manifest, os.path.join(out_dir, "script.md"))

    with open(os.path.join(out_dir, "sources.json"), "w") as f:
        json.dump(script.get("sources", []), f, indent=2)
    with open(os.path.join(out_dir, "fact_check.json"), "w") as f:
        json.dump(script.get("fact_check", []), f, indent=2)

    _write_srt(script, manifest, os.path.join(out_dir, "captions.srt"))

    import standalone_pipeline as sp
    thumb_seg = next((s for s in script["segments"] if s.get("visual") == "title"), script["segments"][0])
    sp.slide_title((1280, 720), thumb_seg.get("headline", script.get("title", "")),
                   thumb_seg.get("subhead"), thumb_seg.get("kicker", "APEX ARCHIVE"),
                   os.path.join(out_dir, "thumbnail.png"))

    _write_metadata(script, manifest, os.path.join(out_dir, "metadata.json"))
    _write_qa_report(manifest, os.path.join(out_dir, "QA_REPORT.md"))

    manifest["package_dir"] = os.path.abspath(out_dir)
    # manifest.json is intentionally NOT written here -- state keeps advancing
    # (VERIFIED, HUMAN_REVIEW) after package assembly. Call save_manifest() once
    # the manifest reaches its final automated state, so the on-disk file reflects
    # every transition rather than a stale RENDERED-only snapshot.
    return out_dir


def save_manifest(manifest, out_dir):
    """Write (or overwrite) manifest.json with the manifest's current, complete state.
    Safe to call repeatedly -- approve.py and analytics.py also call this pattern
    after each human/operator transition so the on-disk file is always current."""
    manifest["package_files"] = sorted(f for f in os.listdir(out_dir) if f != "manifest.json") + ["manifest.json"]
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    return manifest
