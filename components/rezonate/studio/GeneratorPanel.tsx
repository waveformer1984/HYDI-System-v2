'use client';
import React, { useState, useRef, useCallback } from 'react';
import { useAudioEngine } from '../../../providers/rezonate/AudioEngineProvider';
import { TrackGenerator, GenerationType, GeneratedTrack } from '../../../lib/rezonate/TrackGenerator';
import { WaveformDisplay } from './WaveformDisplay';

const GENERATOR_TYPES: { id: GenerationType; label: string }[] = [
  { id: 'drum', label: 'Drums' },
  { id: 'melody', label: 'Melody' },
  { id: 'vocal', label: 'Vocals' },
  { id: 'full_track', label: 'Full Track' },
];

const KEYS = ['C major', 'D major', 'E major', 'F major', 'G major', 'A major', 'B major',
               'A minor', 'B minor', 'C minor', 'D minor', 'E minor', 'F minor', 'G minor'];
const STYLES = ['pop', 'hip-hop', 'electronic', 'jazz', 'rock', 'r&b', 'classical'];

interface GeneratorPanelProps {
  projectId: string;
  /** Called when the user loads a generated or user-supplied buffer to a pad slot. */
  onLoadToPad?: (padIndex: number, buffer: AudioBuffer, label: string) => void;
}

export function GeneratorPanel({ projectId, onLoadToPad }: GeneratorPanelProps) {
  const { engine, samples, bpm } = useAudioEngine();
  const [activeType, setActiveType] = useState<GenerationType>('drum');
  const [key, setKey] = useState('C major');
  const [style, setStyle] = useState('pop');
  const [bars, setBars] = useState(4);
  const [status, setStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [generated, setGenerated] = useState<GeneratedTrack | null>(null);
  const [targetPad, setTargetPad] = useState(0);
  const generatorRef = useRef<TrackGenerator | null>(null);

  function getGenerator(): TrackGenerator {
    if (!generatorRef.current) {
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
      const fnUrl = `${baseUrl}/functions/v1/rezonate-ai-assist`;
      generatorRef.current = new TrackGenerator(engine, fnUrl);
    }
    return generatorRef.current;
  }

  const handleGenerate = useCallback(async () => {
    setStatus('generating');
    setErrorMsg('');
    setGenerated(null);
    try {
      const gen = getGenerator();
      const result = await gen.generate({ projectId, type: activeType, bpm, key, style, bars });
      setGenerated(result);
      setStatus('ready');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  }, [activeType, bpm, key, style, bars, projectId]);

  const handleLoadToPad = useCallback(() => {
    if (!generated) return;
    const padId = `pad-${targetPad}`;
    // Store buffer directly in SampleStore by stuffing it via a private-ish path
    // SampleStore.loadBlob expects a Blob — we work around it by encoding to WAV
    // via OfflineAudioContext. For now we use a simpler approach: store the buffer
    // directly using the internal _buffers Map via a helper cast.
    const store = samples as unknown as { _buffers: Map<string, AudioBuffer> };
    store._buffers.set(padId, generated.buffer);
    onLoadToPad?.(targetPad, generated.buffer, generated.label);
  }, [generated, targetPad, samples, onLoadToPad]);

  const handleUserFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('generating');
    try {
      await samples.loadBlob(`pad-${targetPad}`, file);
      const buf = samples.get(`pad-${targetPad}`);
      setGenerated({
        type: activeType,
        buffer: buf!,
        label: `Custom: ${file.name}`,
        rawResult: {},
      });
      setStatus('ready');
      onLoadToPad?.(targetPad, buf!, `Custom: ${file.name}`);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
    e.target.value = '';
  }, [activeType, samples, targetPad, onLoadToPad]);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
      <h3 className="text-white font-semibold text-sm tracking-wide uppercase">Generator</h3>

      {/* Type tabs */}
      <div className="flex gap-1">
        {GENERATOR_TYPES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { setActiveType(id); setGenerated(null); setStatus('idle'); }}
            className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors
              ${activeType === id ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <label className="block text-gray-400 mb-1">Key</label>
          <select value={key} onChange={e => setKey(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs">
            {KEYS.map(k => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-gray-400 mb-1">Style</label>
          <select value={style} onChange={e => setStyle(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs">
            {STYLES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-gray-400 mb-1">Bars</label>
          <select value={bars} onChange={e => setBars(Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs">
            {[1,2,4,8].map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-gray-400 mb-1">BPM</label>
          <span className="text-white">{bpm}</span>
          <span className="text-gray-500 ml-1">(from transport)</span>
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={status === 'generating'}
        className="w-full py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
      >
        {status === 'generating' ? 'Generating…' : `Generate ${GENERATOR_TYPES.find(t => t.id === activeType)?.label}`}
      </button>

      {status === 'error' && (
        <p className="text-red-400 text-xs">{errorMsg}</p>
      )}

      {/* Preview */}
      {generated && (
        <div className="space-y-2">
          <p className="text-gray-400 text-xs">{generated.label}</p>
          <WaveformDisplay audioBuffer={generated.buffer} color="#8b5cf6" height={48} />
        </div>
      )}

      {/* Load controls */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-xs">→ Pad</span>
        <select value={targetPad} onChange={e => setTargetPad(Number(e.target.value))}
          className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs">
          {Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
        </select>
        <button
          onClick={handleLoadToPad}
          disabled={!generated}
          className="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded text-xs font-medium transition-colors"
        >
          Load to Pad
        </button>
      </div>

      {/* User sample override */}
      <div>
        <label className="block text-gray-400 text-xs mb-1">Replace with your own sample</label>
        <label className="flex items-center justify-center w-full py-1.5 border border-dashed border-gray-600 rounded cursor-pointer hover:border-violet-500 transition-colors">
          <span className="text-gray-400 text-xs">Choose file</span>
          <input type="file" accept="audio/*" className="hidden" onChange={handleUserFile} />
        </label>
      </div>
    </div>
  );
}
