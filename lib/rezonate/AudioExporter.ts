/**
 * AudioExporter — renders the active pattern to an AudioBuffer via
 * OfflineAudioContext and encodes the result as a WAV Blob.
 *
 * WAV format: PCM 16-bit stereo (or mono if only 1 channel), little-endian.
 * No external dependencies — uses only Web Audio API + TypedArrays.
 */

export interface ExportOptions {
  /** Beats per minute */
  bpm: number;
  /** Number of bars to render */
  bars?: number;
  /** Sample rate — defaults to 44100 */
  sampleRate?: number;
}

/** Encode a rendered AudioBuffer to a WAV Blob (PCM 16-bit). */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataByteLength = length * numChannels * (bitsPerSample / 8);
  const headerByteLength = 44;
  const totalByteLength = headerByteLength + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalByteLength);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, totalByteLength - 8, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // sub-chunk size
  view.setUint16(20, 1, true);            // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  // Interleave channels and convert float32 → int16
  let offset = 44;
  for (let sample = 0; sample < length; sample++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch);
      const clamped = Math.max(-1, Math.min(1, channelData[sample]));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Render a 16-step pattern to a WAV Blob.
 *
 * @param patternSteps  boolean[][] — [trackIndex][stepIndex], 16 steps per track
 * @param trackBuffers  Map of trackId → AudioBuffer (from SampleStore)
 * @param trackIds      ordered array of track IDs (index matches patternSteps row)
 * @param opts          bpm, bars, sampleRate
 */
export async function renderPatternToWav(
  patternSteps: boolean[][],
  trackBuffers: Map<string, AudioBuffer>,
  trackIds: string[],
  opts: ExportOptions,
): Promise<Blob> {
  const { bpm, bars = 4, sampleRate = 44100 } = opts;
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = secondsPerBeat * 4;
  const totalSeconds = secondsPerBar * bars;
  const stepDuration = secondsPerBar / 16;

  const offline = new OfflineAudioContext(2, Math.ceil(totalSeconds * sampleRate), sampleRate);

  patternSteps.forEach((steps, trackIndex) => {
    const trackId = trackIds[trackIndex];
    if (!trackId) return;
    const buf = trackBuffers.get(trackId);
    if (!buf) return;

    steps.forEach((active, stepIndex) => {
      if (!active) return;
      const startTime = stepIndex * stepDuration;
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.connect(offline.destination);
      src.start(startTime);
    });
  });

  const rendered = await offline.startRendering();
  return audioBufferToWav(rendered);
}
