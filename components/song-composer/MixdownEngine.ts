/**
 * MixdownEngine.ts
 * OfflineAudioContext-based render pipeline.
 * Accepts recorded layers (Blob + timing) → produces a stereo WAV Blob.
 */

export interface MixdownLayer {
  id: string;
  name: string;
  blob: Blob;
  start_bar: number;
  duration_bars: number;
  muted: boolean;
  gain?: number;        // 0.0 – 1.0, default 1.0
}

export interface MixdownOptions {
  bpm: number;
  sampleRate?: number;   // default 44100
  onProgress?: (_pct: number, _stage: string) => void;
}

export interface MixdownResult {
  blob: Blob;
  duration_sec: number;
  size_kb: number;
  filename: string;
}

// ─── WAV encoder ─────────────────────────────────────────────────────────────

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWAV(rendered: AudioBuffer): Blob {
  const numCh    = rendered.numberOfChannels;
  const sr       = rendered.sampleRate;
  const numSamples = rendered.length;
  const bps      = 2;                           // 16-bit PCM
  const blockAlign = numCh * bps;
  const byteRate  = sr * blockAlign;
  const dataSize  = numSamples * blockAlign;
  const buf       = new ArrayBuffer(44 + dataSize);
  const view      = new DataView(buf);

  // RIFF/WAVE header
  writeString(view, 0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  writeString(view, 8,  'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16,        true);   // PCM sub-chunk size
  view.setUint16(20, 1,         true);   // format: PCM
  view.setUint16(22, numCh,     true);
  view.setUint32(24, sr,        true);
  view.setUint32(28, byteRate,  true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bps * 8,   true);  // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize,  true);

  // Interleave channels → 16-bit signed PCM
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const f = Math.max(-1, Math.min(1, rendered.getChannelData(ch)[i]));
      view.setInt16(offset, f < 0 ? f * 0x8000 : f * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buf], { type: 'audio/wav' });
}

// ─── Core pipeline ───────────────────────────────────────────────────────────

function barsToSeconds(bars: number, bpm: number): number {
  return (bars / bpm) * 60 * 4;   // bars × (60s/beat) × (4 beats/bar)
}

export async function renderMasterMixdown(
  layers: MixdownLayer[],
  options: MixdownOptions
): Promise<MixdownResult> {
  const { bpm, sampleRate = 44100, onProgress } = options;
  const activeLayers = layers.filter((l) => !l.muted && l.blob);

  if (activeLayers.length === 0) {
    throw new Error('No active (unmuted) layers available for mixdown.');
  }

  onProgress?.(5, 'Decoding audio…');

  // ── Phase 1: decode all blobs to determine total duration ──────────────────
  // We need a temporary AudioContext just for decoding durations
  const tmpCtx = new AudioContext({ sampleRate });
  const durations = await Promise.all(
    activeLayers.map(async (l) => {
      const ab = await l.blob.arrayBuffer();
      const buf = await tmpCtx.decodeAudioData(ab);
      const startSec = barsToSeconds(l.start_bar - 1, bpm);
      return startSec + buf.duration;
    })
  );
  await tmpCtx.close();

  const totalDurationSec = Math.max(...durations, 1);
  const totalSamples = Math.ceil(totalDurationSec * sampleRate);

  onProgress?.(20, 'Preparing offline renderer…');

  // ── Phase 2: create OfflineAudioContext and schedule all sources ───────────
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Master limiter to prevent clipping on the way out
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value      = 3;
  limiter.ratio.value     = 20;
  limiter.attack.value    = 0.003;
  limiter.release.value   = 0.1;
  limiter.connect(offlineCtx.destination);

  // Per-layer decode + position
  for (let i = 0; i < activeLayers.length; i++) {
    const layer = activeLayers[i];
    onProgress?.(20 + Math.round((i / activeLayers.length) * 50), `Loading layer: ${layer.name}…`);

    const ab  = await layer.blob.arrayBuffer();
    const buf = await offlineCtx.decodeAudioData(ab);

    const source = offlineCtx.createBufferSource();
    source.buffer = buf;

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = layer.gain ?? 1.0;

    source.connect(gainNode);
    gainNode.connect(limiter);

    const startSec = barsToSeconds(layer.start_bar - 1, bpm);
    source.start(startSec);
  }

  onProgress?.(75, 'Rendering mixdown…');

  // ── Phase 3: offline render (CPU-bound, runs at max speed) ────────────────
  const rendered = await offlineCtx.startRendering();

  onProgress?.(90, 'Encoding WAV…');

  // ── Phase 4: WAV encode ────────────────────────────────────────────────────
  const wav  = encodeWAV(rendered);
  const size = Math.round(wav.size / 1024);

  onProgress?.(100, 'Done');

  return {
    blob: wav,
    duration_sec: rendered.duration,
    size_kb: size,
    filename: `mixdown_${Date.now()}.wav`,
  };
}

// ─── Convenience: trigger browser download ────────────────────────────────────

export function downloadMixdown(result: MixdownResult): void {
  const url = URL.createObjectURL(result.blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
