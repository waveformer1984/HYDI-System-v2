/**
 * TrackGenerator — calls the rezonate-generate edge function (which routes
 * to Google Lyria, Replicate MusicGen, or ElevenLabs) and returns a decoded
 * AudioBuffer for immediate playback and SampleStore loading.
 */

import { AudioEngine } from './AudioEngine';

export type GenerationType = 'drum' | 'melody' | 'vocal' | 'full_track' | 'fx';
export type AIProvider = 'google_lyria' | 'replicate_musicgen' | 'elevenlabs' | 'oscillator';

export interface GeneratorOptions {
  projectId: string;
  type: GenerationType;
  prompt?: string;
  bpm?: number;
  key?: string;
  style?: string;
  bars?: number;
  duration?: number;
  provider?: AIProvider;
  musicgen_model?: 'stereo-melody-large' | 'melody-large' | 'large' | 'medium';
}

export interface GeneratedTrack {
  type: GenerationType;
  buffer: AudioBuffer;
  label: string;
  provider: AIProvider;
  rawResult: Record<string, unknown>;
}

// Default prompts per type to help users get started
const DEFAULT_PROMPTS: Record<GenerationType, string> = {
  drum: 'punchy drum beat with kick and snare',
  melody: 'catchy melodic hook with piano or synth',
  vocal: 'wordless vocal melody, oh and ah sounds',
  full_track: 'upbeat music track with drums, bass, and melody',
  fx: 'atmospheric texture and ambient sound',
};

// Best provider per type (user can override)
const DEFAULT_PROVIDER: Record<GenerationType, AIProvider> = {
  drum: 'elevenlabs',
  melody: 'replicate_musicgen',
  vocal: 'google_lyria',
  full_track: 'replicate_musicgen',
  fx: 'elevenlabs',
};

export class TrackGenerator {
  private readonly _engine: AudioEngine;
  private readonly _generateUrl: string;

  constructor(engine: AudioEngine, generateBaseUrl: string) {
    this._engine = engine;
    // generateBaseUrl is the Supabase functions base URL
    this._generateUrl = generateBaseUrl.endsWith('/')
      ? `${generateBaseUrl}rezonate-generate`
      : `${generateBaseUrl}/rezonate-generate`;
  }

  async generate(opts: GeneratorOptions): Promise<GeneratedTrack> {
    const provider = opts.provider ?? DEFAULT_PROVIDER[opts.type] ?? 'replicate_musicgen';

    // Fall back to oscillator if no API keys (development mode)
    if (provider === 'oscillator') {
      return this._generateOscillator(opts);
    }

    const prompt = opts.prompt || DEFAULT_PROMPTS[opts.type];
    const bpm = opts.bpm ?? 120;
    const bars = opts.bars ?? 4;
    const secondsPerBar = (60 / bpm) * 4;
    const duration = opts.duration ?? Math.round(secondsPerBar * bars);

    const res = await fetch(this._generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
      },
      body: JSON.stringify({
        provider,
        prompt,
        duration,
        bpm,
        key: opts.key,
        style: opts.style,
        type: opts.type,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Generation failed (${provider}): ${err.error ?? res.statusText}`);
    }

    const json = await res.json();
    const result = json.result as {
      audio_url?: string;
      audio_base64?: string;
      content_type: string;
      provider: AIProvider;
      duration_s: number;
      prompt_used: string;
    };

    if (!result) throw new Error('No result from generation service');

    // Decode to AudioBuffer
    const buffer = await this._decodeResult(result);

    return {
      type: opts.type,
      buffer,
      label: `${result.provider} — ${prompt.slice(0, 40)}`,
      provider: result.provider,
      rawResult: result as unknown as Record<string, unknown>,
    };
  }

  private async _decodeResult(result: {
    audio_url?: string;
    audio_base64?: string;
    content_type: string;
  }): Promise<AudioBuffer> {
    let blob: Blob;

    if (result.audio_url) {
      const res = await fetch(result.audio_url);
      if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
      blob = await res.blob();
    } else if (result.audio_base64) {
      const binary = atob(result.audio_base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: result.content_type });
    } else {
      throw new Error('No audio data in result');
    }

    return this._engine.decodeBlob(blob);
  }

  // Oscillator fallback (used when provider='oscillator' or no API keys)
  private async _generateOscillator(opts: GeneratorOptions): Promise<GeneratedTrack> {
    const bpm = opts.bpm ?? 120;
    const bars = opts.bars ?? 4;
    const sampleRate = 44100;
    const spb = 60 / bpm;
    const totalSeconds = spb * 4 * bars;
    const offline = new OfflineAudioContext(1, Math.ceil(totalSeconds * sampleRate), sampleRate);

    if (opts.type === 'drum') {
      const pattern = [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0];
      const stepDur = (spb * 4) / 16;
      pattern.forEach((active, i) => {
        if (!active) return;
        const t = i * stepDur;
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        gain.gain.setValueAtTime(1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain).connect(offline.destination);
        osc.start(t); osc.stop(t + 0.15);
      });
    } else {
      const freqs = [261.63, 329.63, 392, 349.23, 440, 392, 329.63, 261.63];
      freqs.forEach((freq, i) => {
        const t = i * spb * 0.5;
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.type = opts.type === 'vocal' ? 'sawtooth' : 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + spb * 0.4);
        osc.connect(gain).connect(offline.destination);
        osc.start(t); osc.stop(t + spb * 0.5);
      });
    }

    const buffer = await offline.startRendering();
    return {
      type: opts.type,
      buffer,
      label: `Oscillator (fallback) — ${opts.type}`,
      provider: 'oscillator',
      rawResult: {},
    };
  }
}
