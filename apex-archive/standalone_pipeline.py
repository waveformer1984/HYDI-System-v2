"""
Apex Archive -- standalone single-file pipeline.
Usage: python3 standalone_pipeline.py my_script.json out.mp4 [--shorts]

TTS provider abstraction: synthesize() tries providers in priority order and
records which one actually ran (get_active_provider()). Piper (higher quality)
is used automatically if a voice model is present in voices/; eSpeak-ng (offline,
no API key, always available) is the guaranteed fallback -- the base pipeline
never requires a paid API to run. A future provider can be added by writing a
synth_<name>(text, out_path) function and inserting it into PROVIDER_ORDER.
"""
import ctypes
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave

import espeakng_loader
from PIL import Image, ImageDraw, ImageFont

CHANNEL_NAME = "Apex Archive"
TAGLINE = "Motorsport history, one lap at a time."
BG_DARK = "#0E1013"
BG_DARK2 = "#181B20"
ACCENT_RED = "#E10600"
ACCENT_GOLD = "#FFB800"
TEXT_WHITE = "#F5F5F5"
TEXT_GRAY = "#9AA0A6"
FONT_BOLD = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_SEMI = "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf"
FONT_REG = "/usr/share/fonts/truetype/lato/Lato-Regular.ttf"
FONT_MED = "/usr/share/fonts/truetype/lato/Lato-Medium.ttf"
LONGFORM_SIZE = (1920, 1080)
SHORTS_SIZE = (1080, 1920)
FPS = 30

VOICES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
AUDIO_OUTPUT_SYNCHRONOUS = 2
ESPEAK_RATE, ESPEAK_VOLUME, ESPEAK_PITCH = 1, 2, 3

_ACTIVE_PROVIDER = None


def get_active_provider():
    return _ACTIVE_PROVIDER or "unknown"


class EspeakEngine:
    def __init__(self, voice="en-us", speed=158, pitch=42, volume=100):
        self._lib_path = espeakng_loader.get_library_path()
        self._data_path = espeakng_loader.get_data_path()
        self._data_parent = self._data_path.rsplit(os.sep + "espeak-ng-data", 1)[0]
        self.lib = ctypes.CDLL(self._lib_path)
        self._samples = bytearray()
        self.CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.POINTER(ctypes.c_int))
        self._cb = self.CALLBACK(self._on_samples)
        self.rate = self.lib.espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, self._data_parent.encode(), 0)
        if self.rate <= 0:
            self.rate = 22050
        self.lib.espeak_SetSynthCallback(self._cb)
        self.lib.espeak_SetVoiceByName(voice.encode())
        self.lib.espeak_SetParameter(ESPEAK_RATE, speed, 0)
        self.lib.espeak_SetParameter(ESPEAK_VOLUME, volume, 0)
        self.lib.espeak_SetParameter(ESPEAK_PITCH, pitch, 0)

    def _on_samples(self, wav, numsamples, events):
        if numsamples > 0 and wav:
            buf = ctypes.cast(wav, ctypes.POINTER(ctypes.c_short * numsamples)).contents
            self._samples.extend(struct.pack("<%dh" % numsamples, *buf))
        return 0

    def synth_to_wav(self, text, out_path):
        self._samples = bytearray()
        text_bytes = text.encode("utf-8")
        self.lib.espeak_Synth(text_bytes, len(text_bytes) + 1, 0, 0, 0, 0x1000, None, None)
        self.lib.espeak_Synchronize()
        with wave.open(out_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.rate)
            w.writeframes(bytes(self._samples))
        return len(self._samples) / 2 / self.rate


def find_piper_voice():
    if not os.path.isdir(VOICES_DIR):
        return None
    for f in os.listdir(VOICES_DIR):
        if f.endswith(".onnx"):
            model = os.path.join(VOICES_DIR, f)
            cfg = model + ".json"
            if os.path.exists(cfg):
                return model, cfg
    return None


def synth_piper(text, out_path, model_path):
    piper_bin = shutil.which("piper") or os.path.expanduser("~/.local/bin/piper")
    subprocess.run([piper_bin, "--model", model_path, "--output_file", out_path], input=text.encode("utf-8"), check=True, capture_output=True)
    with wave.open(out_path, "rb") as w:
        return w.getnframes() / w.getframerate()


_engine = None


def synth_espeak(text, out_path):
    global _engine
    if _engine is None:
        _engine = EspeakEngine()
    return _engine.synth_to_wav(text, out_path)


def synthesize(text, out_path):
    """Provider priority: Piper (if a voice model is present) -> eSpeak-ng (always
    available, offline, no API key). Records which provider actually produced the
    audio in _ACTIVE_PROVIDER so the manifest can report it."""
    global _ACTIVE_PROVIDER
    piper = find_piper_voice()
    if piper:
        try:
            duration = synth_piper(text, out_path, piper[0])
            _ACTIVE_PROVIDER = "piper"
            return duration
        except Exception as e:
            print(f"[tts] Piper failed ({e}), falling back to espeak-ng")
    duration = synth_espeak(text, out_path)
    _ACTIVE_PROVIDER = "espeak-ng"
    return duration


def _font(path, size):
    return ImageFont.truetype(path, max(size, 1))


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))


def _gradient_bg(size, top=BG_DARK, bottom=BG_DARK2):
    w, h = size
    img = Image.new("RGB", size, _hex(top))
    top_c, bot_c = _hex(top), _hex(bottom)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(top_c[0] + (bot_c[0] - top_c[0]) * t)
        g = int(top_c[1] + (bot_c[1] - top_c[1]) * t)
        b = int(top_c[2] + (bot_c[2] - top_c[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    return img


def _speed_lines(size, n=14, color=ACCENT_RED, alpha=26):
    w, h = size
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    rc = _hex(color)
    span = w + h
    for i in range(n):
        x = -h + i * (2 * span // n)
        od.line([(x, h), (x + h, 0)], fill=(rc[0], rc[1], rc[2], alpha), width=6)
    return overlay


def _wrap_text(draw, text, font, max_width):
    words = text.split()
    lines, cur = [], ""
    for word in words:
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def _checker_strip(size, height=10, n=24, colors=(TEXT_WHITE, BG_DARK)):
    w, _ = size
    img = Image.new("RGBA", (w, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cw = max(w // n, 1)
    c1, c2 = _hex(colors[0]), _hex(colors[1])
    for i in range(n):
        d.rectangle([i * cw, 0, (i + 1) * cw, height], fill=(c1 if i % 2 == 0 else c2))
    return img


def slide_title(size, headline, subhead=None, kicker=None, out_path=None):
    img = _gradient_bg(size)
    overlay = _speed_lines(size)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = size
    ref = min(w, h)
    margin = int(w * 0.08)
    cy = h // 2
    if kicker:
        kf = _font(FONT_SEMI, int(ref * 0.038))
        draw.text((margin, cy - int(ref * 0.18)), kicker.upper(), font=kf, fill=_hex(ACCENT_GOLD))
    hf_size = int(ref * 0.095) if len(headline) < 28 else int(ref * 0.068)
    hf = _font(FONT_BOLD, hf_size)
    lines = _wrap_text(draw, headline, hf, w - 2 * margin)
    total_h = len(lines) * (hf_size * 1.15)
    y = cy - total_h / 2
    for line in lines:
        draw.text((margin, y), line, font=hf, fill=_hex(TEXT_WHITE))
        y += hf_size * 1.15
    if subhead:
        sf = _font(FONT_REG, int(ref * 0.036))
        draw.text((margin, y + int(ref * 0.025)), subhead, font=sf, fill=_hex(TEXT_GRAY))
    strip = _checker_strip(size, height=max(int(h * 0.012), 6))
    img.paste(strip, (0, h - strip.height), strip)
    if out_path:
        img.save(out_path)
    return img


def slide_stat_bars(size, title, items, unit="", out_path=None):
    img = _gradient_bg(size)
    draw = ImageDraw.Draw(img)
    w, h = size
    ref = min(w, h)
    margin = int(w * 0.08)
    tf_size = int(ref * 0.062)
    tf = _font(FONT_BOLD, tf_size)
    title_lines = _wrap_text(draw, title, tf, w - 2 * margin)
    ty = int(h * 0.07)
    for line in title_lines:
        draw.text((margin, ty), line, font=tf, fill=_hex(TEXT_WHITE))
        ty += int(tf_size * 1.2)
    max_val = max(v for _, v in items) or 1
    n = len(items)
    bar_h = int(ref * 0.10)
    gap = int(ref * 0.06)
    group_h = n * bar_h + (n - 1) * gap
    area_top = ty + int(ref * 0.04)
    area_bottom = int(h * 0.94)
    y = area_top + max((area_bottom - area_top - group_h) // 2, 0)
    max_bar_w = w - 2 * margin - int(w * 0.20)
    lf = _font(FONT_MED, int(bar_h * 0.42))
    vf = _font(FONT_SEMI, int(bar_h * 0.5))
    for i, (label, val) in enumerate(items):
        bw = max(int(max_bar_w * (val / max_val)), 6)
        color = _hex(ACCENT_RED) if i > 0 else _hex(ACCENT_GOLD)
        draw.rounded_rectangle([margin, y, margin + bw, y + bar_h], radius=bar_h // 4, fill=color)
        draw.text((margin, y - int(bar_h * 0.46)), label, font=lf, fill=_hex(TEXT_GRAY))
        draw.text((margin + bw + int(w * 0.02), y + bar_h * 0.22), f"{val}{unit}", font=vf, fill=_hex(TEXT_WHITE))
        y += bar_h + gap
    if out_path:
        img.save(out_path)
    return img


def slide_timeline(size, title, events, highlight_index=None, out_path=None):
    img = _gradient_bg(size)
    draw = ImageDraw.Draw(img)
    w, h = size
    ref = min(w, h)
    margin = int(w * 0.08)
    portrait = h > w
    tf_size = int(ref * 0.062)
    tf = _font(FONT_BOLD, tf_size)
    title_lines = _wrap_text(draw, title, tf, w - 2 * margin)
    ty = int(h * 0.07)
    for line in title_lines:
        draw.text((margin, ty), line, font=tf, fill=_hex(TEXT_WHITE))
        ty += int(tf_size * 1.2)
    n = len(events)
    yf = _font(FONT_BOLD, int(ref * 0.04))
    lf = _font(FONT_REG, int(ref * 0.03))
    if portrait:
        line_x = margin + int(ref * 0.02)
        area_top = ty + int(ref * 0.06)
        area_bottom = int(h * 0.94)
        draw.line([(line_x, area_top), (line_x, area_bottom)], fill=_hex(TEXT_GRAY), width=4)
        step = (area_bottom - area_top) / max(n - 1, 1)
        label_max_w = w - line_x - margin - int(ref * 0.06)
        for i, (year, label) in enumerate(events):
            yy = area_top + step * i
            is_hi = (highlight_index is not None and i == highlight_index)
            r = int(ref * 0.016) if is_hi else int(ref * 0.009)
            color = _hex(ACCENT_RED) if is_hi else _hex(TEXT_WHITE)
            draw.ellipse([line_x - r, yy - r, line_x + r, yy + r], fill=color)
            tx = line_x + int(ref * 0.05)
            draw.text((tx, yy), year, font=yf, fill=color, anchor="lm")
            lines = _wrap_text(draw, label, lf, label_max_w)
            ly = yy + int(ref * 0.045)
            for ln in lines:
                draw.text((tx, ly), ln, font=lf, fill=_hex(TEXT_GRAY), anchor="lm")
                ly += int(ref * 0.038)
    else:
        line_y = int(h * 0.52)
        draw.line([(margin, line_y), (w - margin, line_y)], fill=_hex(TEXT_GRAY), width=4)
        step = (w - 2 * margin) / max(n - 1, 1)
        for i, (year, label) in enumerate(events):
            x = margin + step * i
            is_hi = (highlight_index is not None and i == highlight_index)
            r = int(ref * 0.016) if is_hi else int(ref * 0.009)
            color = _hex(ACCENT_RED) if is_hi else _hex(TEXT_WHITE)
            draw.ellipse([x - r, line_y - r, x + r, line_y + r], fill=color)
            draw.text((x, line_y - int(ref * 0.06)), year, font=yf, fill=color, anchor="mb")
            lines = _wrap_text(draw, label, lf, step * 0.92)
            ly = line_y + int(ref * 0.05)
            for ln in lines:
                draw.text((x, ly), ln, font=lf, fill=_hex(TEXT_GRAY), anchor="ma")
                ly += int(ref * 0.036)
    if out_path:
        img.save(out_path)
    return img


def slide_quote(size, text, attribution=None, out_path=None):
    img = _gradient_bg(size, top=BG_DARK2, bottom=BG_DARK)
    draw = ImageDraw.Draw(img)
    w, h = size
    ref = min(w, h)
    margin = int(w * 0.12)
    qf_size = int(ref * 0.062) if len(text) < 90 else int(ref * 0.046)
    qf = _font(FONT_SEMI, qf_size)
    lines = _wrap_text(draw, f"“{text}”", qf, w - 2 * margin)
    total_h = len(lines) * qf_size * 1.3
    y = h / 2 - total_h / 2
    for line in lines:
        draw.text((w / 2, y), line, font=qf, fill=_hex(TEXT_WHITE), anchor="ma", align="center")
        y += qf_size * 1.3
    if attribution:
        af = _font(FONT_REG, int(ref * 0.03))
        attrib_lines = _wrap_text(draw, f"— {attribution}", af, w - 2 * margin)
        y += int(ref * 0.02)
        for line in attrib_lines:
            draw.text((w / 2, y), line, font=af, fill=_hex(ACCENT_GOLD), anchor="ma", align="center")
            y += int(af.size * 1.25)
    if out_path:
        img.save(out_path)
    return img


def slide_plain(size, out_path=None, top=BG_DARK, bottom=BG_DARK2):
    img = _gradient_bg(size, top=top, bottom=bottom)
    if out_path:
        img.save(out_path)
    return img


def slide_outro(size, out_path=None):
    img = _gradient_bg(size)
    draw = ImageDraw.Draw(img)
    w, h = size
    ref = min(w, h)
    margin = int(w * 0.1)
    tf = _font(FONT_BOLD, int(ref * 0.07))
    sf = _font(FONT_REG, int(ref * 0.034))
    cf = _font(FONT_SEMI, int(ref * 0.038))
    draw.text((w / 2, h * 0.4), CHANNEL_NAME, font=tf, fill=_hex(TEXT_WHITE), anchor="mm", align="center")
    y = h * 0.48
    for line in _wrap_text(draw, TAGLINE, sf, w - 2 * margin):
        draw.text((w / 2, y), line, font=sf, fill=_hex(TEXT_GRAY), anchor="mm", align="center")
        y += int(sf.size * 1.3)
    y = h * 0.6
    for line in _wrap_text(draw, "SUBSCRIBE FOR MORE RACING HISTORY", cf, w - 2 * margin):
        draw.text((w / 2, y), line, font=cf, fill=_hex(ACCENT_RED), anchor="mm", align="center")
        y += int(cf.size * 1.3)
    strip = _checker_strip(size, height=max(int(h * 0.015), 6))
    img.paste(strip, (0, h - strip.height), strip)
    if out_path:
        img.save(out_path)
    return img


FFMPEG = "ffmpeg"


def _wrap_caption(text, font_path, font_size, max_width):
    img = Image.new("RGB", (10, 10))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, font_size)
    words = text.split()
    lines, cur = [], ""
    for word in words:
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def render_slide_for_segment(seg, size, out_png):
    vtype = seg.get("visual", "title")
    if vtype == "title":
        slide_title(size, seg.get("headline", ""), seg.get("subhead"), seg.get("kicker"), out_png)
    elif vtype == "stat_bars":
        slide_stat_bars(size, seg.get("title", ""), [tuple(i) for i in seg["items"]], seg.get("unit", ""), out_png)
    elif vtype == "timeline":
        slide_timeline(size, seg.get("title", ""), [tuple(e) for e in seg["events"]], seg.get("highlight_index"), out_png)
    elif vtype == "quote":
        slide_quote(size, seg.get("text", ""), seg.get("attribution"), out_png)
    elif vtype == "outro":
        slide_outro(size, out_png)
    else:
        slide_plain(size, out_png)
    return out_png


def build_segment_clip(seg_index, seg, size, workdir, fps=FPS, caption=True):
    w, h = size
    audio_path = os.path.join(workdir, f"seg{seg_index:02d}.wav")
    duration = max(synthesize(seg["narration"], audio_path), 1.2)
    img_path = os.path.join(workdir, f"seg{seg_index:02d}.png")
    render_slide_for_segment(seg, size, img_path)
    frames = max(int(duration * fps), 2)
    zoom_dir = seg.get("zoom", "in")
    if zoom_dir == "in":
        zexpr = "min(zoom+0.0012,1.18)"
    elif zoom_dir == "out":
        zexpr = "if(eq(on,0),1.18,max(zoom-0.0012,1.0))"
    else:
        zexpr = "1.05"
    clip_path = os.path.join(workdir, f"seg{seg_index:02d}.mp4")
    vf_parts = [f"zoompan=z='{zexpr}':d={frames}:s={w}x{h}:fps={fps}", "format=yuv420p"]
    caption_text = seg.get("caption", seg.get("narration"))
    if caption and caption_text:
        max_w = int(w * 0.82)
        font_size = int(h * 0.032)
        wrapped = _wrap_caption(caption_text, FONT_MED, font_size, max_w)
        cap_file = os.path.join(workdir, f"seg{seg_index:02d}_cap.txt")
        with open(cap_file, "w") as f:
            f.write(wrapped)
        box_y = int(h * 0.80)
        vf_parts.append(f"drawtext=fontfile={FONT_MED}:textfile={cap_file}:fontsize={font_size}:fontcolor=white:line_spacing=6:box=1:boxcolor=black@0.55:boxborderw=24:x=(w-text_w)/2:y={box_y}")
    vf = ",".join(vf_parts)
    cmd = [FFMPEG, "-y", "-loop", "1", "-i", img_path, "-i", audio_path, "-vf", vf, "-r", str(fps),
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
           "-shortest", "-pix_fmt", "yuv420p", clip_path]
    subprocess.run(cmd, check=True, capture_output=True)
    return clip_path, duration


def assemble_episode(script_path, out_path, shorts=False, captions=True):
    with open(script_path) as f:
        script = json.load(f)
    size = SHORTS_SIZE if shorts else LONGFORM_SIZE
    workdir = tempfile.mkdtemp(prefix="apex_archive_")
    clip_paths, seg_durations = [], []
    total_dur = 0.0
    for i, seg in enumerate(script["segments"]):
        clip_path, dur = build_segment_clip(i, seg, size, workdir, caption=captions)
        clip_paths.append(clip_path)
        seg_durations.append(dur)
        total_dur += dur
        print(f"  segment {i+1}/{len(script['segments'])}: {dur:.1f}s  [{seg.get('visual')}]")
    list_file = os.path.join(workdir, "concat_list.txt")
    with open(list_file, "w") as f:
        for p in clip_paths:
            f.write(f"file '{os.path.abspath(p)}'\n")
    subprocess.run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", out_path], check=True, capture_output=True)
    shutil.rmtree(workdir, ignore_errors=True)
    print(f"Done: {out_path}  (~{total_dur:.1f}s of narration, TTS provider: {get_active_provider()})")
    return out_path, total_dur, seg_durations, get_active_provider()


if __name__ == "__main__":
    _out_path, _total_dur, _seg_durations, _provider = assemble_episode(sys.argv[1], sys.argv[2], shorts="--shorts" in sys.argv)
    with open(os.path.splitext(sys.argv[2])[0] + ".durations.json", "w") as _f:
        json.dump({"seg_durations": _seg_durations, "tts_provider": _provider}, _f)
