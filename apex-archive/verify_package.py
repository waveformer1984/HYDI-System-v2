"""Objective, independent release-gate checker for an Apex Archive episode package.
Run any time after manifest.py has produced episode/manifest.json:
  python3 verify_package.py episode/manifest.json
Prints PASS/FAIL per check; exit code is 1 if anything fails. This is the mandatory
gate before HUMAN_REVIEW delivery -- it recomputes hashes and re-runs technical QA
independently rather than trusting what the manifest claims about itself.
"""
import copy
import hashlib
import importlib
import json
import os
import sys

import manifest as manifest_mod
import qa_check

try:
    import episode_registry
except ImportError:
    episode_registry = None

REQUIRED_FILES = ["manifest.json", "script.json", "script.md", "sources.json", "fact_check.json",
                   "narration.wav", "video.mp4", "captions.srt", "thumbnail.png", "metadata.json",
                   "QA_REPORT.md"]
FORBIDDEN_STRINGS = ["oauth", "api_key", "apikey", "client_secret", "youtube.com/upload",
                      "googleapis.com/upload", "access_token", "-----begin", "aws_secret"]
PIPELINE_FILES = ["standalone_pipeline.py", "qa_check.py", "manifest.py", "approve.py", "hydi_bridge.py",
                   "verify_package.py", "episode_registry.py", "analytics.py", "editorial.py", "youtube_adapter.py"]
EXPECTED_THUMB_SIZE = (1280, 720)


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _no_credentials_in_pipeline(package_dir):
    pipeline_dir = os.path.dirname(os.path.abspath(package_dir))
    py_files = [f for f in PIPELINE_FILES if os.path.exists(os.path.join(pipeline_dir, f))]
    for fname in py_files:
        with open(os.path.join(pipeline_dir, fname), encoding="utf-8", errors="ignore") as f:
            text = f.read().lower()
        for bad in FORBIDDEN_STRINGS:
            if bad in text:
                return False, f"found '{bad}' in {fname}"
    return True, ""


def _hydi_resilience_self_test():
    os.environ["HYDI_BRIDGE_URL"] = "http://127.0.0.1:1/unreachable-on-purpose"
    try:
        import hydi_bridge
        importlib.reload(hydi_bridge)
        result = hydi_bridge.emit("self_test", {"probe": True})
        ok = result.get("_delivery", {}).get("sent") is False
    except Exception:
        ok = False
    finally:
        os.environ.pop("HYDI_BRIDGE_URL", None)
        try:
            import hydi_bridge
            importlib.reload(hydi_bridge)
        except Exception:
            pass
    return ok


def _validate_srt_timing(path):
    with open(path) as f:
        text = f.read()
    blocks = [b for b in text.strip().split("\n\n") if b.strip()]
    if not blocks:
        return False, "captions.srt has no cue blocks"
    last_end = -1.0
    for b in blocks:
        lines = b.splitlines()
        if len(lines) < 2 or "-->" not in lines[1]:
            return False, f"malformed cue block: {b[:60]!r}"
        start_s, end_s = [t.strip() for t in lines[1].split("-->")]

        def to_seconds(t):
            h, m, rest = t.split(":")
            s, ms = rest.split(",")
            return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0

        start, end = to_seconds(start_s), to_seconds(end_s)
        if end <= start:
            return False, f"cue has non-positive duration: {lines[1]}"
        if start < last_end - 0.01:
            return False, f"cue timestamps not monotonic at {lines[1]}"
        last_end = end
    return True, f"{len(blocks)} cues, monotonic and non-overlapping"


def check_package(package_dir, manifest):
    results = []

    def check(name, ok, detail=""):
        results.append({"check": name, "passed": bool(ok), "detail": detail})

    for fname in REQUIRED_FILES:
        path = os.path.join(package_dir, fname)
        check(f"artifact present: {fname}", os.path.exists(path))
        if os.path.exists(path):
            check(f"artifact non-empty: {fname}", os.path.getsize(path) > 0)

    video_path = os.path.join(package_dir, "video.mp4")
    narration_path = os.path.join(package_dir, "narration.wav")
    if os.path.exists(video_path):
        check("render_sha256 matches video.mp4 (independently recomputed)",
              _sha256_file(video_path) == manifest.get("render_sha256"))
        qa_result = qa_check.run_qa(video_path, expected_format=manifest.get("format"),
                                     narration_path=narration_path if os.path.exists(narration_path) else None)
        check("technical media QA independently re-passes on packaged video.mp4", qa_result.get("passed"),
              "; ".join(qa_result.get("errors", [])))
        thumb_path = os.path.join(package_dir, "thumbnail.png")
        if os.path.exists(thumb_path):
            frame_ok, frame_detail = qa_check.sample_frame_sanity(video_path, os.path.join(package_dir, ".sample_frame.png"))
            check("sampled video frame is not blank/corrupt", frame_ok, frame_detail)

    script_path = os.path.join(package_dir, "script.json")
    if os.path.exists(script_path):
        with open(script_path, "rb") as f:
            script_bytes = f.read()
        recomputed = hashlib.sha256(script_bytes.decode("utf-8", errors="replace").encode("utf-8")).hexdigest()
        check("script_sha256 matches script.json (independently recomputed)", recomputed == manifest.get("script_sha256"))

    thumb_path = os.path.join(package_dir, "thumbnail.png")
    if os.path.exists(thumb_path):
        from PIL import Image
        with Image.open(thumb_path) as img:
            check("thumbnail dimensions match expected 1280x720", img.size == EXPECTED_THUMB_SIZE, str(img.size))

    captions_path = os.path.join(package_dir, "captions.srt")
    if os.path.exists(captions_path):
        srt_ok, srt_detail = _validate_srt_timing(captions_path)
        check("caption timing is valid (monotonic, non-overlapping, positive duration)", srt_ok, srt_detail)

    meta_path = os.path.join(package_dir, "metadata.json")
    if os.path.exists(meta_path):
        import youtube_adapter
        ready, issues = youtube_adapter.check_upload_readiness(package_dir)
        check("metadata is structurally valid for upload (no credentials needed for this check)", ready, "; ".join(issues))

    check("sources present", len(manifest.get("sources", [])) > 0)
    check("fact_check present", len(manifest.get("fact_check", [])) > 0)
    unsupported = [c for c in manifest.get("fact_check", []) if c.get("verification_status") == "unsupported"]
    check("no unsupported critical claims remain in fact_check", len(unsupported) == 0, str(unsupported))
    check("script QA passed", bool((manifest.get("script_qa") or {}).get("passed")))
    check("technical QA recorded as passed in manifest", bool((manifest.get("technical_qa") or {}).get("passed")))

    hist_states = [h["new_state"] for h in manifest.get("history", [])]
    expected_prefix = manifest_mod.STATES[:len(hist_states)]
    check("history matches state order exactly (no skips/gaps)", hist_states == expected_prefix, f"history={hist_states}")
    check("history has no duplicate states", len(hist_states) == len(set(hist_states)))
    check("every history entry carries episode_id/actor/timestamp/manifest_hash",
          all(h.get("episode_id") and h.get("actor") and h.get("timestamp") and h.get("manifest_hash") for h in manifest.get("history", [])))

    check("manifest internally consistent: episode_id present and non-empty", bool(manifest.get("episode_id")))
    check("manifest internally consistent: state is a known state", manifest.get("state") in manifest_mod.STATES)

    cred_ok, cred_detail = _no_credentials_in_pipeline(package_dir)
    check("no publish credentials referenced anywhere in pipeline code", cred_ok, cred_detail)

    check("HYDI bridge fails closed (no exception, sent=False) when unreachable", _hydi_resilience_self_test())

    import hydi_bridge
    outbox_dir = hydi_bridge.OUTBOX_DIR  # anchored to hydi_bridge.py's own location, not guessed from package_dir nesting
    matching = set()
    if os.path.isdir(outbox_dir):
        for fname in os.listdir(outbox_dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(outbox_dir, fname)) as f:
                    ev = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            if ev.get("payload", {}).get("episode_id") == manifest.get("episode_id"):
                matching.add(ev.get("event_type"))
    check("HYDI episode_generated event emitted for this episode", "episode_generated" in matching)
    if manifest.get("state") in ("VERIFIED", "HUMAN_REVIEW", "APPROVED", "READY_TO_UPLOAD", "PUBLISHED", "ANALYZED"):
        check("HYDI episode_verified event emitted for this episode", "episode_verified" in matching)
    if manifest.get("state") in ("HUMAN_REVIEW", "APPROVED", "READY_TO_UPLOAD", "PUBLISHED", "ANALYZED"):
        check("HYDI project_status event emitted for this episode", "project_status" in matching)
        check("HYDI orchestration_ping event emitted for this episode", "orchestration_ping" in matching)

    if episode_registry is not None:
        registry = episode_registry.load_registry()
        others = [r for r in registry if r.get("episode_id") != manifest.get("episode_id")]
        findings = episode_registry.check_duplicates(
            manifest.get("episode_id"), manifest.get("title"), manifest.get("script_sha256"),
            [s.get("url") for s in manifest.get("sources", [])], registry=others,
        )
        blocking = [f for f in findings if f["severity"] == "blocking"]
        check("no blocking duplicate found in episode registry", len(blocking) == 0, str(blocking))

    if manifest.get("state") in ("HUMAN_REVIEW", "APPROVED", "READY_TO_UPLOAD", "PUBLISHED", "ANALYZED"):
        m_copy = copy.deepcopy(manifest)
        try:
            manifest_mod._advance(m_copy, "APPROVED", "scheduler", "should be blocked", actor_type="task")
            check("automated task cannot self-approve past HUMAN_REVIEW", False, "task-actor advance did not raise")
        except manifest_mod.StateError:
            check("automated task cannot self-approve past HUMAN_REVIEW", True)

    if manifest.get("state") == "PUBLISHED":
        m_copy = copy.deepcopy(manifest)
        try:
            manifest_mod.human_approve(m_copy, "should-fail")
            check("PUBLISHED cannot be re-approved", False, "human_approve did not raise")
        except manifest_mod.StateError:
            check("PUBLISHED cannot be re-approved", True)

    return results


if __name__ == "__main__":
    manifest_path = sys.argv[1]
    with open(manifest_path) as f:
        manifest = json.load(f)
    package_dir = os.path.dirname(os.path.abspath(manifest_path))
    results = check_package(package_dir, manifest)
    n_pass = sum(1 for r in results if r["passed"])
    print(f"=== Apex Archive package verification: {manifest.get('title')} ({manifest.get('episode_id')}) ===")
    print(f"Package state: {manifest.get('state')}")
    for r in results:
        mark = "PASS" if r["passed"] else "FAIL"
        line = f"[{mark}] {r['check']}"
        if r["detail"]:
            line += f"  ({r['detail']})"
        print(line)
    print(f"\n{n_pass}/{len(results)} checks passed")
    sys.exit(0 if n_pass == len(results) else 1)
