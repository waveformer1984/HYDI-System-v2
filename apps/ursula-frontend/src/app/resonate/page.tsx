'use client';

import React, { useState } from 'react';

interface Track {
  name: string;
  sequence: Array<{ time: string; note: string; duration: string; type: string }>;
}

export default function ResonateStudio() {
  const [bpm, setBpm] = useState<number>(120);
  const [style, setStyle] = useState<string>('electronic');
  const [length, setLength] = useState<number>(4);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const generateSequence = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'resonate',
          params: { bpm, style, length },
          idempotencyKey: `resonate-${Date.now()}`
        })
      });
      const data = await response.json();
      if (data.tracks) {
        setTracks(data.tracks);
      }
    } catch (error) {
      console.error("Failed to fetch audio sequence from Ursula Agent:", error);
    } finally {
      setLoading(false);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-500">
          RESONATE // AUDIO ENGINE
        </h1>
        <p className="text-sm text-neutral-400 mt-1">Algorithmic execution track composer</p>
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
            onClick={generateSequence}
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-neutral-800 text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors shadow-lg shadow-violet-900/20"
          >
            {loading ? 'Compiling Matrix...' : 'Generate New Array'}
          </button>
        </div>

        {/* Matrix Timeline / Output Panel */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-neutral-200">Arrangement Editor</h3>
              {tracks.length > 0 && (
                <button
                  onClick={togglePlayback}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${
                    isPlaying ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {isPlaying ? 'Stop Loop' : 'Play Sequence'}
                </button>
              )}
            </div>

            {tracks.length === 0 ? (
              <div className="border border-dashed border-neutral-800 rounded-lg p-12 text-center text-neutral-500">
                No active sequence array found. Click &quot;Generate New Array&quot; to hydrate the canvas.
              </div>
            ) : (
              <div className="space-y-4">
                {tracks.map((track, i) => (
                  <div key={i} className="bg-neutral-950 border border-neutral-800 rounded-lg p-4">
                    <div className="text-xs font-bold text-violet-400 mb-2 uppercase tracking-wide">{track.name}</div>
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                      {track.sequence.map((note, noteIdx) => (
                        <div key={noteIdx} className="bg-neutral-900 border border-neutral-800 rounded p-2 text-center shadow-sm">
                          <div className="text-xs font-mono font-bold text-neutral-200">{note.note}</div>
                          <div className="text-[10px] font-mono text-neutral-500 mt-0.5">{note.time}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
