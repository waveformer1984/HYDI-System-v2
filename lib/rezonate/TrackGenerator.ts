/**
 * TrackGenerator — calls the generation edge function and renders the
 * returned note/pattern data into an AudioBuffer via Web Audio oscillators.
 * The resulting buffer can be handed to SampleStore to replace a pad/track.
 */

import { AudioEngine } from './AudioEngine';

export type GenerationType = 'drum' | 'melody' | 'vocal' | 'full_track';

export interface GeneratorOptions {
  projectId: string;
  type: GenerationType;
  bpm?: number;
  key?: string;
  style?: string;
  bars?: number;
  syllables?: string[];
}

export interface GeneratedTrack {
  type: GenerationType;
  buffer: AudioBuffer;
  label: string;
  rawResult: Record<string, unknown>;
}

const NOTE_FREQ: Record<number, number> = (() => {
  const map: Record<number, number> = {};
  for (let m = 21; m <= 108; m++) {
    map[m] = 440 * Math.pow(2, (m - 69) / 12);
  }
  return map;
})();

function midiToFreq(midi: number): number {
  return NOTE_FREQ[midi] ?? 440;
}

export class TrackGenerator {
  private readonly _engine: AudioEngine;
  private readonly _aiAssistUrl: string;

  constructor(engine: AudioEngine, aiAssistBaseUrl: string) {
    this._engine = engine;
    this._aiAssistUrl = aiAssistBaseUrl;
  }

  async generate(opts: GeneratorOptions): Promise<GeneratedTrack> {
    const requestTypeMap: Record<GenerationType, string> = {
      drum: 'generate_drum_layer',
      melody: 'generate_melody',
      vocal: 'generate_vocal_line',
      full_track: 'generate_full_track',
    };

    const requestType = requestTypeMap[opts.type];
    const context: Record<string, unknown> = {
      bpm: opts.bpm ?? 120,
      key: opts.key ?? 'C major',
      style: opts.style ?? 'pop',
      bars: opts.bars ?? 4,
      syllables: opts.syllables,
    };

    const res = await fetch(this._aiAssistUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: opts.projectId, request_type: requestType, context }),
    });

    if (!res.ok) throw new Error(`TrackGenerator: ai-assist returned ${res.status}`);
    const json = await res.json();
    const rawResult = json.result as Record<string, unknown>;

    const bpm = opts.bpm ?? 120;
    const bars = opts.bars ?? 4;
    const secondsPerBeat = 60 / bpm;
    const totalSeconds = bars * 4 * secondsPerBeat;

    const buffer = await this._renderToBuffer(opts.type, rawResult, totalSeconds, bpm);

    return {
      type: opts.type,
      buffer,
      label: `Generated ${opts.type} — ${opts.key ?? 'C major'} ${opts.style ?? 'pop'}`,
      rawResult,
    };
  }

  private async _renderToBuffer(
    type: GenerationType,
    result: Record<string, unknown>,
    totalSeconds: number,
    bpm: number,
  ): Promise<AudioBuffer> {
    const ctx = this._engine.getCtx();
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(totalSeconds * sampleRate);
    // Create an offline context to render into a buffer
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const spb = 60 / bpm;

    if (type === 'drum') {
      const pattern = (result.pattern as number[]) ?? [1,0,0,0,1,0,0,0];
      const steps = pattern.length;
      const stepDur = (spb * 4) / steps;
      pattern.forEach((active, i) => {
        if (!active) return;
        const t = i * stepDur;
        // Kick: 60Hz sine burst
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        gain.gain.setValueAtTime(1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain).connect(offline.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    } else if (type === 'melody' || type === 'vocal') {
      const notes = (result.notes ?? result.phonemes) as Array<{note?: number; pitch_midi?: number; time_beats: number; duration_beats: number; velocity?: number}> ?? [];
      const waveform = (type === 'vocal') ? 'sawtooth' : 'sine';
      notes.forEach((n) => {
        const midi = n.note ?? n.pitch_midi ?? 60;
        const freq = midiToFreq(midi);
        const t = n.time_beats * spb;
        const dur = n.duration_beats * spb;
        const vel = (n.velocity ?? 80) / 127;
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        (osc as OscillatorNode).type = waveform as OscillatorType;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vel * 0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.05, dur - 0.05));
        osc.connect(gain).connect(offline.destination);
        osc.start(t);
        osc.stop(t + dur);
      });
    } else if (type === 'full_track') {
      // Composite: render drum layer from layers.drums.pattern
      const layers = result.layers as Record<string, Record<string, unknown>> ?? {};
      const drumPattern = (layers.drums?.pattern as number[]) ?? [];
      const steps = drumPattern.length;
      const stepDur = steps > 0 ? (spb * 4) / steps : spb / 4;
      drumPattern.forEach((active, i) => {
        if (!active) return;
        const t = i * stepDur;
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        gain.gain.setValueAtTime(0.8, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain).connect(offline.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    }

    return offline.startRendering();
  }
}
