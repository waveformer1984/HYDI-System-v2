#!/usr/bin/env python3
"""
Rezonate - make-stems.py
Turn a track (Suno download, etc.) into swappable stems + tempo/key.

    python make-stems.py "C:\\path\\to\\song.mp3"

Output -> rezonate\\stems\\<songname>\\
    vocals.wav  drums.wav  bass.wav  other.wav   track.json

Loads audio with soundfile and runs Demucs as a library (no torchaudio/torchcodec),
so it works on plain CPU. A 3-minute song takes a few minutes to split.
"""
import sys, os, json


def split_stems(src, out_dir):
    """Run htdemucs via the Python API; load/save with soundfile (no torchaudio I/O)."""
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    print("  loading model (htdemucs)...")
    model = get_model('htdemucs')
    model.cpu().eval()

    data, sr = sf.read(src, always_2d=True)        # (samples, channels) - soundfile reads mp3/wav/flac
    data = np.asarray(data, dtype='float32').T     # -> (channels, samples)
    if data.shape[0] == 1:
        data = np.repeat(data, 2, axis=0)          # mono -> stereo
    elif data.shape[0] > 2:
        data = data[:2]
    wav = torch.from_numpy(data)

    if sr != model.samplerate:
        import torchaudio.functional as AF         # pure DSP, no codec/IO
        wav = AF.resample(wav, sr, model.samplerate)
        sr = model.samplerate

    ref = wav.mean(0)
    mean, std = float(ref.mean()), float(ref.std()) + 1e-8
    wav_n = (wav - mean) / std

    print("  separating (CPU - a few minutes; one progress bar per chunk)...")
    with torch.no_grad():
        sources = apply_model(model, wav_n[None], device='cpu', progress=True)[0]
    sources = sources * std + mean

    os.makedirs(out_dir, exist_ok=True)
    stems = []
    for name, source in zip(model.sources, sources):    # drums, bass, other, vocals
        path = os.path.join(out_dir, name + '.wav')
        sf.write(path, source.t().cpu().numpy(), sr)
        stems.append(name + '.wav')
    return stems


def detect_bpm_key(path):
    """Tempo + key via librosa (Krumhansl-Schmuckler). Best-effort."""
    try:
        import numpy as np
        import soundfile as sf
        import scipy.signal as _ss
        if not hasattr(_ss, 'hann'):
            _ss.hann = _ss.windows.hann                 # newer scipy moved hann -> windows.hann
        import librosa
        data, sr = sf.read(path, always_2d=True)        # avoid librosa.load (pulls removed 'sunau' on py3.13)
        y = np.asarray(data, dtype='float32').mean(axis=1)
        if len(y) > sr * 120:
            y = y[:int(sr * 120)]
        tempo = float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0])
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
        maj = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
        minp = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
        names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
        best = None
        for i in range(12):
            for prof, mode in ((maj, 'maj'), (minp, 'min')):
                score = float(np.corrcoef(np.roll(prof, i), chroma)[0, 1])
                if best is None or score > best[0]:
                    best = (score, "%s %s" % (names[i], mode))
        return round(tempo), best[1]
    except Exception as e:
        print("  (tempo/key detection skipped: %s)" % e)
        return None, None


def main():
    if len(sys.argv) < 2:
        print('usage: python make-stems.py "path\\to\\song.mp3"')
        return
    src = sys.argv[1]
    if not os.path.isfile(src):
        print("file not found:", src)
        return

    name = os.path.splitext(os.path.basename(src))[0]
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, 'stems', name)

    import glob
    existing = sorted(glob.glob(os.path.join(out, '*.wav')))
    if existing:
        print("  stems already exist - skipping separation, just refreshing tempo/key.")
        stems = [os.path.basename(w) for w in existing]
    else:
        try:
            stems = split_stems(src, out)
        except Exception as e:
            print("Separation failed:", e)
            return

    print("Detecting tempo + key...")
    bpm, key = detect_bpm_key(src)

    meta = {"name": name, "source": os.path.abspath(src),
            "bpm": bpm, "key": key, "stems": stems, "folder": out}
    with open(os.path.join(out, "track.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print("\nDone.")
    print("  stems:", ", ".join(stems))
    print("  bpm:", bpm, "| key:", key)
    print("  folder:", out)
    print("  -> drag these .wav onto separate Ableton tracks, set tempo to", bpm,
          "- then swap any stem with your own audio.")


if __name__ == "__main__":
    main()
