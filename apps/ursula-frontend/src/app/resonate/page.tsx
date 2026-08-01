'use client';

import React, { useState } from 'react';

interface Track {
  name: string;
  sequence: Array<{ time: string; note: string; duration: string; type: string }>;
}

const API_BASE = process.env.NEXT_PUBLIC_REZONATE_API_URL || 'http://localhost:3001';

export default function ResonateStudio() {
  const [bpm, setBpm] = useState<number>(120);
  const [style, setStyle] = useState<string>('electronic');
  const [length, setLength] = useState<number>(4);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSong = async () => {
    setGenerating(true);
    setError(null);
    setAudioUrl(null);
    try {
      const prompt = `${style} composition, ${bpm} BPM, ${length} bars`;
      const clip = length <= 8;

      const createRes = await fetch(`${API_BASE}/processing/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: 'generate', prompt, clip })
      });
      const createData = await createRes.json();
      if (!createData.ok) throw new Error(createData.error || 'Failed to create job');
      const jobId = createData.job.id;

      const startRes = await fetch(`${API_BASE}/processing/jobs/${jobId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const startData = await startRes.json();
      if (!startData.ok) throw new Error(startData.error || 'Generation failed');

      const asset = startData.asset;
      if (!asset) throw new Error('No asset returned');

      setAudioUrl(`${API_BASE}/assets/${asset.id}/file`);
      setTracks([{ name: 'Generated', sequence: [] }]);
    } catch (err: any) {
      console.error('Resonate generation failed:', err);
      setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-500">
          RESONATE // AUDIO ENGINE
        </h1>
        <p className="text-sm text-neutral-400 mt-1">ProtoForge Resonate integration — real AI audio generation</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Controls Panel */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 h-fit space-y-6">
          <h2 className="text-lg font-bold text-neutral-200">Session Controls</h2>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-neutral-400 mb-2">Genre Matrix</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-violet-500"
            >
              <option value="electronic">Electronic</option>
              <option value="ambient">Ambient</option>
              <option value="techno">Techno</option>
              <option value="lofi">Lo-Fi</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-neutral-400 mb-2">Tempo ({bpm} BPM)</label>
            <input
              type="range" min="60" max="180" value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              className="w-full accent-violet-500 bg-neutral-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-neutral-400 mb-2">Loop Length ({length} Bars)</label>
            <input
              type="number" min="2" max="16" value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-violet-500"
            />
          </div>

          <button
            onClick={generateSong}
            disabled={generating}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-neutral-800 text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors shadow-lg shadow-violet-900/20"
          >
            {generating ? 'Generating...' : 'Generate Song'}
          </button>

          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}
        </div>

        {/* Output Panel */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
            <h3 className="text-lg font-bold text-neutral-200 mb-4">Generated Audio</h3>

            {audioUrl ? (
              <div className="space-y-4">
                <audio controls className="w-full" src={audioUrl}>
                  Your browser does not support the audio element.
                </audio>
                <p className="text-xs text-neutral-500 font-mono">{audioUrl}</p>
              </div>
            ) : (
              <div className="border border-dashed border-neutral-800 rounded-lg p-12 text-center text-neutral-500">
                No generated audio yet. Click &quot;Generate Song&quot; to create a ProtoForge asset.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
