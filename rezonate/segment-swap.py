#!/usr/bin/env python3
"""
Rezonate — segment-swap.py (V1)

Deterministic segment replacement:

    song / stems folder
      -> stems (cached or Demucs)
      -> beat/bar segmentation (from analyzed BPM, 4/4)
      -> catalog sample ranking (deterministic, honest about unknowns)
      -> librosa time-stretch (duration) + pitch-shift (key), kept separate
      -> replace only the requested bar range in the target stem
      -> mixdown modified stem + untouched stems -> output.wav
      -> manifest.json with full provenance

CLI:
    python segment-swap.py --input "song.mp3" --stem drums --bars 4-8 \
        --samples "drum loop" --max-replacements 4
    python segment-swap.py --stems-dir "stems\\Bad Decision Club" \
        --stem drums --bars 4-8 --samples "drums 128"
    python segment-swap.py ... --plan            # manifest only, no audio render
    python segment-swap.py ... --json            # machine-readable stdout
"""
import sys, os, json, re, hashlib, argparse, datetime, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_VERSION = "segment-swap/1.0.0"
STEMS = ["vocals", "drums", "bass", "other"]
CATALOG_PATH = os.path.join(HERE, "samples-catalog.json")
BEATS_PER_BAR = 4          # V1: 4/4 only — recorded as meterAssumed in manifest
MAX_STRETCH = 2.0          # refuse fits beyond 0.5x..2x — quality floor
EDGE_FADE_SEC = 0.01       # 10ms crossfade at replacement edges, kills clicks
MIN_DURATION_RATIO = 0.25  # samples much shorter than the segment are rejected


def die(msg, code=2):
    print("error: %s" % msg, file=sys.stderr)
    sys.exit(code)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_path(p, label, write=False):
    """Writes are confined to the Rezonate tree or the OS temp dir (tests).
    Reads additionally allow the user home (songs live in Downloads) —
    catalog sample paths come pre-vetted from samples-catalog.json."""
    import tempfile
    ap = os.path.abspath(p)
    roots = [os.path.realpath(HERE), os.path.realpath(tempfile.gettempdir())]
    if not write:
        roots.append(os.path.realpath(os.path.expanduser("~")))
    rp = os.path.realpath(ap)
    if not any(rp == r or rp.startswith(r + os.sep) for r in roots):
        die("%s escapes approved directories: %s" % (label, ap))
    return ap


# ── make-stems reuse ───────────────────────────────────────────────────

def _load_make_stems():
    spec = importlib.util.spec_from_file_location("make_stems", os.path.join(HERE, "make-stems.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ensure_stems(input_path, stems_dir, verbose=True):
    """Return (stems_folder, track_json) — reuse cache or run Demucs once."""
    if stems_dir:
        folder = os.path.abspath(stems_dir)
    else:
        name = re.sub(r"[^\w\- ]", "", os.path.splitext(os.path.basename(input_path))[0]).strip()
        folder = os.path.join(HERE, "stems", name)
    tj = os.path.join(folder, "track.json")
    have = all(os.path.exists(os.path.join(folder, s + ".wav")) for s in STEMS)
    if have:
        if verbose: print("  stems cache hit: %s" % folder)
        meta = json.load(open(tj)) if os.path.exists(tj) else {}
        return folder, meta
    if not input_path:
        die("no stems at %s and no --input song supplied" % folder)
    src = safe_path(input_path, "input")
    if not os.path.exists(src):
        die("input not found: %s" % src)
    if verbose: print("  running Demucs (one-time per song)…")
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(HERE, "make-stems.py"), src],
                       capture_output=True, text=True, cwd=HERE)
    if verbose: print(r.stdout)
    if r.returncode != 0 or not all(os.path.exists(os.path.join(folder, s + ".wav")) for s in STEMS):
        die("stem separation failed: %s" % (r.stderr or r.stdout)[-400:])
    meta = json.load(open(tj)) if os.path.exists(tj) else {}
    return folder, meta


def get_bpm_key(folder, meta):
    """bpm/key from track.json; detect on the target stem if absent."""
    bpm, key = meta.get("bpm"), meta.get("key")
    if bpm and key:
        return bpm, key, "track.json"
    try:
        ms = _load_make_stems()
        ref = os.path.join(folder, "other.wav")
        b2, k2 = ms.detect_bpm_key(ref)
        return b2 or bpm, k2 or key, "detected"
    except Exception:
        return bpm, key, "unavailable"


# ── segmentation ──────────────────────────────────────────────────────

def segment_range(bpm, start_bar, end_bar, segment_bars):
    """Contiguous bar range -> list of segment dicts, deterministic."""
    if not bpm or bpm <= 0:
        die("bpm unknown — cannot align bars. Re-run with --bpm <n>.")
    if start_bar < 1 or end_bar < start_bar:
        die("invalid bar range %s-%s" % (start_bar, end_bar))
    beat = 60.0 / bpm
    segs = []
    bar = start_bar
    idx = 0
    while bar <= end_bar:
        last = min(bar + segment_bars - 1, end_bar)
        segs.append({
            "segmentIndex": idx,
            "bar": bar,
            "startBeat": (bar - 1) * BEATS_PER_BAR,
            "endBeat": (last) * BEATS_PER_BAR,
            "startTime": round((bar - 1) * BEATS_PER_BAR * beat, 6),
            "endTime": round(last * BEATS_PER_BAR * beat, 6),
            "bpm": bpm,
        })
        bar = last + 1
        idx += 1
    return segs


# ── sample matching ───────────────────────────────────────────────────

NOTE_RE = re.compile(r"\b([A-G][#b]?)m?\b")
BPM_RE = re.compile(r"(\d{2,3})\s*bpm", re.I)


def parse_key_text(s):
    """'F# min' / 'Am' / 'A major' -> (pitchclass, mode) or None."""
    if not s:
        return None
    m = re.search(r"\b([A-Ga-g][#b]?)\s*(m|min|minor|maj|major)?\b", str(s))
    if not m:
        return None
    pc = {"C":0,"C#":1,"DB":1,"D":2,"D#":3,"EB":3,"E":4,"F":5,"F#":6,"GB":6,
          "G":7,"G#":8,"AB":8,"A":9,"A#":10,"BB":10,"B":11}[m.group(1).upper()]
    mode = "min" if (m.group(2) or "").lower() in ("m", "min", "minor") else "maj"
    return pc, mode


def key_from_filename(name):
    """e.g. 'Drums_A#m_128bpm.wav' -> 'A# min'. Returns text key or None."""
    m = re.search(r"([A-G][#b]?)(m|min|maj)\b", name or "")
    if not m:
        return None
    mode = "min" if m.group(2) in ("m", "min") else "maj"
    return "%s %s" % (m.group(1), mode)


def bpm_from_filename(name):
    m = BPM_RE.search(name or "")
    return int(m.group(1)) if m else None


def bpm_score(track_bpm, sample_bpm):
    """1.0 same; half/double-time counts as compatible; unknown -> 0."""
    if track_bpm is None or sample_bpm is None:
        return 0.0
    r = sample_bpm / track_bpm
    for target in (1.0, 2.0, 0.5):
        d = abs(r - target) / target
        if d <= 0.10:
            return 1.0 - d / 0.10 * 0.3
    return max(0.0, 1.0 - abs(r - 1.0) * 2.0)


def key_score(track_key, sample_key):
    if not track_key or not sample_key:
        return 0.0
    tk, sk = parse_key_text(track_key), parse_key_text(sample_key)
    if not tk or not sk:
        return 0.0
    interval = (sk[0] - tk[0]) % 12
    if interval == 0 and tk[1] == sk[1]:
        return 1.0
    if interval == 0 or interval in (7, 5, 3, 4, 8, 9):   # fifth/fourth/relative-adjacent
        return 0.6
    return 0.2


def duration_score(seg_dur, sample_dur):
    if sample_dur <= 0 or seg_dur <= 0:
        return 0.0
    r = sample_dur / seg_dur
    if 1.0 <= r <= 2.0:
        return 1.0
    if 0.5 <= r < 1.0:
        return 0.8     # loopable one-shot/loop shorter than segment
    if r < 0.5:
        return 0.3 if r >= MIN_DURATION_RATIO else 0.0
    return 0.0         # >2x too long


def rank_samples(catalog, query, track_bpm, track_key, seg_dur, get_dur):
    """Deterministic ranking. Unknowns score 0, never guessed."""
    terms = [t for t in re.sub(r"\s+", " ", query.lower()).split() if t]
    out = []
    for s in catalog:
        p = s.get("path")
        if not p or not os.path.exists(p):
            continue                     # catalog rows on unavailable drives are unusable
        hay = " ".join(str(s.get(k) or "") for k in ("name", "folder") ) + " " + " ".join(s.get("tags") or [])
        hay = hay.lower()
        hits = sum(1 for t in terms if t in hay)
        inst = hits / len(terms) if terms else 0.0
        if inst <= 0:
            continue
        sbpm = s.get("bpm") or bpm_from_filename(s.get("name"))
        skey_txt = s.get("key") or key_from_filename(s.get("name") or "")
        sdur = get_dur(s.get("path"))
        parts = {
            "instrument_match": round(inst, 3),
            "bpm_compatibility": round(bpm_score(track_bpm, sbpm), 3),
            "key_compatibility": round(key_score(track_key, skey_txt), 3),
            "duration_compatibility": round(duration_score(seg_dur, sdur or 0), 3),
        }
        conf = (1.0 if sbpm else 0.0) + (1.0 if skey_txt else 0.0)
        parts["metadata_confidence"] = round(min(conf / 2.0, 1.0), 3)
        score = sum(parts.values()) / len(parts)
        out.append({"sample": s.get("name"), "path": s.get("path"), "score": round(score, 4),
                    "sampleBpm": sbpm, "sampleKey": skey_txt, "sampleDuration": sdur,
                    "reason": ";".join("%s=%s" % kv for kv in parts.items()), "parts": parts})
    out.sort(key=lambda x: (-x["score"], x["sample"] or ""))
    return out


# ── audio fit + replace + mix ─────────────────────────────────────────

def pitch_interval(track_key, sample_key, stem):
    """Semitones to apply to the SAMPLE so it matches the track key.
    Percussive target stem -> never pitch-shift (drums aren't pitched here)."""
    tk, sk = parse_key_text(track_key), parse_key_text(sample_key)
    if not tk or not sk:
        return 0, "key_unknown"
    if stem == "drums":
        return 0, "percussive_target"
    diff = (tk[0] - sk[0]) % 12
    if diff > 6:
        diff -= 12
    return diff, "key_match" if diff else "keys_equal"


def render(folder, meta, stem, segs, ranked, out_dir, verbose=True):
    import numpy as np
    import soundfile as sf
    import librosa

    os.makedirs(out_dir, exist_ok=True)
    target_path = os.path.join(folder, stem + ".wav")
    if not os.path.exists(target_path):
        die("stem not found: %s" % target_path)
    y, sr = sf.read(target_path, always_2d=True)
    y = np.asarray(y, dtype="float32")
    n_total, ch = y.shape
    mod = y.copy()
    replacements = []

    for i, seg in enumerate(segs):
        cand = ranked[i % len(ranked)]
        s_start, s_end = int(seg["startTime"] * sr), int(seg["endTime"] * sr)
        s_end = min(s_end, n_total)
        seg_len = s_end - s_start
        target_dur = seg_len / sr
        sy, ssr = sf.read(cand["path"], always_2d=True)
        sy = np.asarray(sy, dtype="float32")
        if ssr != sr:
            sy = librosa.resample(sy.T, orig_sr=ssr, target_sr=sr).T
        if sy.shape[1] == 1 and ch == 2:
            sy = np.repeat(sy, 2, axis=1)
        ratio = sy.shape[0] / sr / target_dur            # >1 => sample longer => speed up
        if ratio > MAX_STRETCH or ratio < 1.0 / MAX_STRETCH:
            replacements.append({"segment": seg["segmentIndex"], "stem": stem,
                "sourceSample": cand["sample"], "samplePath": cand["path"], "sampleHash": None,
                "sampleBpm": cand.get("sampleBpm"), "sampleKey": cand.get("sampleKey"),
                "score": cand["score"], "timeStretchRatio": round(ratio, 4),
                "pitchShiftSemitones": 0, "reason": "rejected: stretch %.2fx out of range" % ratio})
            continue
        cols = [librosa.effects.time_stretch(sy[:, c], rate=ratio) for c in range(sy.shape[1])]
        fitted = np.stack(cols, axis=1)                  # (n, ch)
        if fitted.shape[0] < seg_len:
            pad = np.zeros((seg_len - fitted.shape[0], ch), dtype="float32")
            fitted = np.concatenate([fitted, pad], axis=0)
        fitted = fitted[:seg_len]
        # RMS-match to the original segment so the swap sits at the same energy
        orig_rms = float(np.sqrt(np.mean(y[s_start:s_end] ** 2)) or 1e-9)
        new_rms = float(np.sqrt(np.mean(fitted ** 2)) or 1e-9)
        fitted *= orig_rms / new_rms
        # pitch-fit only when justified
        semis, preason = pitch_interval(meta.get("key"), cand.get("sampleKey"), stem)
        if semis:
            out_ch = []
            for c in range(ch):
                out_ch.append(librosa.effects.pitch_shift(fitted[:, c], sr=sr, n_steps=semis)[:, None])
            fitted = np.concatenate(out_ch, axis=1)
        # edge fades — no clicks at the splice
        fl = min(int(EDGE_FADE_SEC * sr), seg_len // 2)
        ramp = np.linspace(0.0, 1.0, fl, dtype="float32")[:, None]
        fitted[:fl] *= ramp
        fitted[-fl:] *= ramp[::-1]
        mod[s_start:s_end] = fitted
        replacements.append({"segment": seg["segmentIndex"], "stem": stem,
            "sourceSample": cand["sample"], "samplePath": cand["path"],
            "sampleHash": sha256_file(cand["path"]), "sampleBpm": cand.get("sampleBpm"),
            "sampleKey": cand.get("sampleKey"), "score": cand["score"],
            "timeStretchRatio": round(ratio, 4), "pitchShiftSemitones": semis,
            "reason": cand["reason"] + ";pitch=%s" % preason})
        if verbose: print("  seg %d bar %d <- %s (stretch %.3fx, pitch %+d st, score %.3f)"
                          % (seg["segmentIndex"], seg["bar"], cand["sample"], ratio, semis, cand["score"]))

    stem_out = os.path.join(out_dir, "%s_swapped.wav" % stem)
    sf.write(stem_out, mod, sr)

    # mixdown: modified target stem + untouched stems, target length rules
    mix = np.zeros_like(mod)
    for s in STEMS:
        p = stem_out if s == stem else os.path.join(folder, s + ".wav")
        if not os.path.exists(p):
            continue
        a, asr = sf.read(p, always_2d=True)
        a = np.asarray(a, dtype="float32")
        if asr != sr:
            a = librosa.resample(a.T, orig_sr=asr, target_sr=sr).T
        if a.shape[1] == 1 and ch == 2:
            a = np.repeat(a, 2, axis=1)
        if a.shape[0] < mix.shape[0]:
            a = np.concatenate([a, np.zeros((mix.shape[0] - a.shape[0], a.shape[1]), dtype="float32")])
        mix += a[:mix.shape[0], :ch]
    peak = float(np.max(np.abs(mix)) or 0.0)
    limited = False
    if peak > 1.0:
        mix = mix / peak * 0.98
        limited = True
        if verbose: print("  peak %.3f > 1.0 — limited to 0.98 (documented)" % peak)
    out_path = os.path.join(out_dir, "output.wav")
    sf.write(out_path, mix, sr)
    return out_path, stem_out, replacements, limited, sr, ch, n_total


# ── CLI ───────────────────────────────────────────────────────────────

def parse_bars(s):
    m = re.match(r"^(\d+)(?:-(\d+))?$", s.strip())
    if not m:
        die("--bars must be N or N-M, got %r" % s)
    return int(m.group(1)), int(m.group(2) or m.group(1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--stems-dir")
    ap.add_argument("--stem", required=True, choices=STEMS)
    ap.add_argument("--bars", required=True, help="e.g. 4 or 4-8")
    ap.add_argument("--segment-bars", type=int, default=1)
    ap.add_argument("--samples", default="", help="sample query terms")
    ap.add_argument("--max-replacements", type=int, default=4)
    ap.add_argument("--bpm", type=float)
    ap.add_argument("--out-dir")
    ap.add_argument("--catalog", default=CATALOG_PATH)
    ap.add_argument("--plan", action="store_true", help="manifest only, no audio render")
    ap.add_argument("--json", action="store_true", help="machine-readable stdout")
    a = ap.parse_args()

    if not a.input and not a.stems_dir:
        die("supply --input <song> or --stems-dir <folder>")
    out_dir = a.out_dir or os.path.join(HERE, "swaps", "swap-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    out_dir = safe_path(out_dir, "out-dir", write=True)

    quiet = a.json
    def vprint(*x):
        if not quiet: print(*x)

    vprint("INPUT   :", a.input or a.stems_dir)
    folder, meta = ensure_stems(a.input, a.stems_dir, verbose=not quiet)
    bpm = a.bpm or meta.get("bpm")
    key = meta.get("key")
    if bpm is None or key is None:
        try:
            ms = _load_make_stems()
            b2, k2 = ms.detect_bpm_key(os.path.join(folder, "other.wav"))
            bpm = bpm or b2
            key = key or k2
        except Exception:
            pass
    if not bpm or bpm <= 0:
        die("bpm unknown — cannot segment. Pass --bpm <n>.")
    vprint("BPM     :", bpm, "| KEY:", key or "unknown", "| STEM:", a.stem)

    sbar, ebar = parse_bars(a.bars)
    segs = segment_range(bpm, sbar, ebar, a.segment_bars)
    vprint("SEGMENTS:", len(segs), "(bar %d-%d, %d bars each)" % (sbar, ebar, a.segment_bars))

    try:
        catalog = json.load(open(a.catalog, encoding="utf-8"))
        samples = catalog.get("samples", catalog if isinstance(catalog, list) else [])
    except Exception as e:
        die("catalog unreadable: %s" % e)

    # durations via soundfile.info — cheap header read
    import soundfile as sf
    dur_cache = {}
    def get_dur(p):
        if p is None: return 0.0
        if p not in dur_cache:
            try:
                dur_cache[p] = float(sf.info(p).duration)
            except Exception:
                dur_cache[p] = 0.0
        return dur_cache[p]

    seg_dur = segs[0]["endTime"] - segs[0]["startTime"]
    ranked = rank_samples(samples, a.samples or a.stem, bpm, key, seg_dur, get_dur)
    if not ranked:
        die("no catalog samples matched query %r" % (a.samples or a.stem))
    ranked = ranked[: max(1, a.max_replacements)]
    vprint("SELECTED:")
    for r in ranked:
        vprint("   %.3f  %s  (bpm=%s key=%s)" % (r["score"], r["sample"], r["sampleBpm"], r["sampleKey"]))

    manifest = {
        "input": a.input or a.stems_dir,
        "inputHash": sha256_file(a.input) if a.input and os.path.exists(a.input) else None,
        "stemsFolder": folder, "bpm": bpm, "key": key,
        "meter": "4/4", "meterAssumed": True,
        "stems": STEMS, "targetStem": a.stem,
        "segments": segs, "replacements": [],
        "output": None, "outputHash": None, "engineVersion": ENGINE_VERSION,
        "generatedAt": datetime.datetime.now().isoformat(),
    }

    if a.plan:
        manifest["replacements"] = [{"segment": s["segmentIndex"], "stem": a.stem,
            "plannedSample": ranked[i % len(ranked)]["sample"], "score": ranked[i % len(ranked)]["score"],
            "reason": ranked[i % len(ranked)]["reason"]} for i, s in enumerate(segs)]
        man_path = os.path.join(out_dir, "manifest.json")
        os.makedirs(out_dir, exist_ok=True)
        with open(man_path, "w") as f:
            json.dump(manifest, f, indent=2)
        if a.json:
            print(json.dumps(manifest))
        else:
            vprint("PLAN ONLY ->", man_path)
        return

    out_path, stem_out, replacements, limited, sr, ch, n = render(
        folder, meta, a.stem, segs, ranked, out_dir, verbose=not quiet)
    manifest["replacements"] = replacements
    manifest["output"] = out_path
    manifest["outputHash"] = sha256_file(out_path)
    manifest["swappedStem"] = stem_out
    manifest["audio"] = {"sampleRate": sr, "channels": ch, "frames": n, "limited": limited}
    man_path = os.path.join(out_dir, "manifest.json")
    with open(man_path, "w") as f:
        json.dump(manifest, f, indent=2)

    vprint("REPLACEMENTS:", sum(1 for r in replacements if not str(r["reason"]).startswith("rejected")))
    vprint("OUTPUT  :", out_path)
    vprint("MANIFEST:", man_path)
    if a.json:
        print(json.dumps({"output": out_path, "manifest": man_path, "swappedStem": stem_out,
                          "replacements": len(replacements), "bpm": bpm, "key": key}))


if __name__ == "__main__":
    main()
