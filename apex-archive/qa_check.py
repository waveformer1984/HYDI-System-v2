"""Automated technical media QA gate. Checks the render is technically sound and
internally consistent -- not facts/tone (that's fact_check.json + record_fact_check)."""
import json
import subprocess
import sys

MIN_DURATION_S = {"shorts": 3.0, "longform": 3.0}
MAX_DURATION_S = {"shorts": 200.0, "longform": 900.0}   # catches runaway generation
EXPECTED_SIZES = {"shorts": (1080, 1920), "longform": (1920, 1080)}
EXPECTED_FPS = 30
FPS_TOLERANCE = 1
AUDIO_VIDEO_DELTA_TOLERANCE_S = 2.0


def _ffprobe_json(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                          capture_output=True, text=True)
    if out.returncode != 0:
        return None, out.stderr
    try:
        return json.loads(out.stdout), None
    except json.JSONDecodeError as e:
        return None, str(e)


def _parse_fps(rate_str):
    try:
        if "/" in rate_str:
            num, den = rate_str.split("/")
            return float(num) / float(den) if float(den) else 0.0
        return float(rate_str)
    except (ValueError, ZeroDivisionError):
        return 0.0


def run_qa(render_path, expected_format=None, narration_path=None):
    checks, errors = {}, []
    data, err = _ffprobe_json(render_path)
    if data is None:
        return {"passed": False, "checks": {}, "errors": [f"ffprobe failed to read file: {err}"]}

    fmt = data.get("format", {})
    streams = data.get("streams", [])
    v_streams = [s for s in streams if s.get("codec_type") == "video"]
    a_streams = [s for s in streams if s.get("codec_type") == "audio"]
    duration = float(fmt.get("duration", 0) or 0)

    checks["has_duration"] = duration > 0
    checks["duration_seconds"] = round(duration, 2)
    min_d = MIN_DURATION_S.get(expected_format, 3.0)
    max_d = MAX_DURATION_S.get(expected_format, 900.0)
    checks["duration_above_minimum"] = duration >= min_d
    checks["duration_below_maximum"] = duration <= max_d
    if not checks["duration_above_minimum"]:
        errors.append(f"duration {duration:.2f}s is below the {min_d}s minimum (likely a broken render)")
    if not checks["duration_below_maximum"]:
        errors.append(f"duration {duration:.2f}s exceeds the {max_d}s sanity ceiling for format={expected_format}")

    checks["has_video_stream"] = len(v_streams) > 0
    checks["has_audio_stream"] = len(a_streams) > 0
    if not checks["has_video_stream"]:
        errors.append("no video stream found")
    if not checks["has_audio_stream"]:
        errors.append("no audio stream found")

    if v_streams:
        w, h = v_streams[0].get("width"), v_streams[0].get("height")
        checks["resolution"] = f"{w}x{h}"
        if expected_format and expected_format in EXPECTED_SIZES:
            ew, eh = EXPECTED_SIZES[expected_format]
            checks["resolution_matches_expected"] = (w == ew and h == eh)
            if not checks["resolution_matches_expected"]:
                errors.append(f"resolution {w}x{h} doesn't match expected {ew}x{eh} for format={expected_format}")
        else:
            checks["resolution_is_known_format"] = (w, h) in EXPECTED_SIZES.values()
            if not checks["resolution_is_known_format"]:
                errors.append(f"resolution {w}x{h} doesn't match either known output format")

        fps = _parse_fps(v_streams[0].get("r_frame_rate", "0/1"))
        checks["frame_rate"] = round(fps, 2)
        checks["frame_rate_as_expected"] = abs(fps - EXPECTED_FPS) <= FPS_TOLERANCE
        if not checks["frame_rate_as_expected"]:
            errors.append(f"frame rate {fps:.2f} deviates from expected {EXPECTED_FPS}fps by more than {FPS_TOLERANCE}")

    decode = subprocess.run(["ffmpeg", "-v", "error", "-i", render_path, "-f", "null", "-"], capture_output=True, text=True)
    decode_errors = decode.stderr.strip()
    checks["decodes_cleanly"] = decode.returncode == 0 and not decode_errors
    if not checks["decodes_cleanly"]:
        errors.append(f"ffmpeg reported decode errors: {decode_errors[:500]}")

    if narration_path:
        adata, aerr = _ffprobe_json(narration_path)
        if adata is None:
            errors.append(f"narration audio unreadable: {aerr}")
            checks["audio_video_duration_consistent"] = False
        else:
            a_duration = float(adata.get("format", {}).get("duration", 0) or 0)
            delta = abs(a_duration - duration)
            checks["audio_video_duration_delta_s"] = round(delta, 2)
            checks["audio_video_duration_consistent"] = delta <= AUDIO_VIDEO_DELTA_TOLERANCE_S
            if not checks["audio_video_duration_consistent"]:
                errors.append(f"narration duration ({a_duration:.2f}s) vs video duration ({duration:.2f}s) "
                              f"differ by {delta:.2f}s, exceeding {AUDIO_VIDEO_DELTA_TOLERANCE_S}s tolerance")

    passed = len(errors) == 0
    return {"passed": passed, "checks": checks, "errors": errors}


def is_blank_frame(image_path, stddev_threshold=3.0):
    """Basic visual sanity check: a frame with near-zero pixel variance is almost
    certainly a blank/black/corrupt render, not real content."""
    from PIL import Image
    import statistics
    img = Image.open(image_path).convert("L")
    pixels = list(img.getdata())
    sample = pixels[::max(len(pixels) // 5000, 1)]
    stddev = statistics.pstdev(sample) if len(sample) > 1 else 0.0
    return stddev < stddev_threshold, stddev


def sample_frame_sanity(render_path, out_png, timestamp_s=1.0):
    """Extract one frame and confirm it isn't blank. Returns (ok: bool, detail: str)."""
    r = subprocess.run(["ffmpeg", "-y", "-ss", str(timestamp_s), "-i", render_path, "-frames:v", "1", out_png],
                        capture_output=True, text=True)
    if r.returncode != 0 or not __import__("os").path.exists(out_png):
        return False, f"frame extraction failed: {r.stderr[-300:]}"
    blank, stddev = is_blank_frame(out_png)
    if blank:
        return False, f"sampled frame appears blank/corrupt (pixel stddev={stddev:.2f})"
    return True, f"sampled frame has visual content (pixel stddev={stddev:.2f})"


if __name__ == "__main__":
    render_path = sys.argv[1]
    expected_format = sys.argv[2] if len(sys.argv) > 2 else None
    narration_path = sys.argv[3] if len(sys.argv) > 3 else None
    result = run_qa(render_path, expected_format, narration_path)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["passed"] else 1)
