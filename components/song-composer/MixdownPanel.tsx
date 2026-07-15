import React, { useState, useCallback } from 'react';
import { renderMasterMixdown, downloadMixdown, MixdownLayer, MixdownResult } from './MixdownEngine';

interface Props {
  layers: MixdownLayer[];
  bpm: number;
  songTitle: string;
  onClose: () => void;
}

type Phase = 'idle' | 'rendering' | 'done' | 'error';

export default function MixdownPanel({ layers, bpm, songTitle, onClose }: Props) {
  const [phase, setPhase]       = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage]       = useState('');
  const [result, setResult]     = useState<MixdownResult | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const activeLayers = layers.filter((l) => !l.muted && l.blob);

  const handleRender = useCallback(async () => {
    if (activeLayers.length === 0) return;
    setPhase('rendering');
    setError(null);

    try {
      const res = await renderMasterMixdown(activeLayers, {
        bpm,
        sampleRate: 44100,
        onProgress: (pct, s) => { setProgress(pct); setStage(s); },
      });
      setResult(res);
      setPhase('done');
    } catch (err: any) {
      setError(err.message);
      setPhase('error');
    }
  }, [activeLayers, bpm]);

  const handleDownload = useCallback(() => {
    if (result) {
      downloadMixdown({
        ...result,
        filename: `${songTitle.replace(/\s+/g, '_')}_mixdown.wav`,
      });
    }
  }, [result, songTitle]);

  function formatDur(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  function formatSize(kb: number) {
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-950 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="font-bold text-white">Export Mixdown</h2>
            <p className="text-xs text-gray-400 mt-0.5">OfflineAudioContext · 44.1 kHz · 16-bit WAV</p>
          </div>
          {phase !== 'rendering' && (
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
          )}
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Layer summary */}
          <div>
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Layers to mix</p>
            {activeLayers.length === 0 ? (
              <div className="text-sm text-yellow-400 bg-yellow-950/40 rounded-lg px-3 py-2">
                No unmuted layers with audio. Record something first.
              </div>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {layers.map((l) => (
                  <div key={l.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${l.muted ? 'opacity-30' : ''}`}>
                    <span className={`w-2 h-2 rounded-full ${l.muted ? 'bg-gray-600' : 'bg-green-500'}`} />
                    <span className="text-gray-200 flex-1">{l.name}</span>
                    <span className="text-gray-500">bar {l.start_bar}</span>
                    {l.muted && <span className="text-gray-600">muted</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Progress bar */}
          {(phase === 'rendering' || phase === 'done') && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>{stage}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full bg-gradient-to-r from-indigo-600 to-purple-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Result */}
          {phase === 'done' && result && (
            <div className="bg-green-950/40 border border-green-800/50 rounded-xl px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
                <span>✓</span> Mixdown complete
              </div>
              <div className="text-xs text-gray-400 space-y-0.5">
                <div>Duration: {formatDur(result.duration_sec)}</div>
                <div>File size: {formatSize(result.size_kb)}</div>
                <div>Format: 44.1 kHz · 16-bit stereo WAV</div>
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && error && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Rendering notice */}
          {phase === 'rendering' && (
            <div className="text-xs text-gray-500 text-center">
              Rendering at CPU speed — this is faster than real time.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 flex gap-3">
          {phase === 'idle' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 border border-gray-700 text-gray-400 rounded-lg text-sm hover:bg-gray-800">
                Cancel
              </button>
              <button
                onClick={handleRender}
                disabled={activeLayers.length === 0}
                className="flex-1 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-lg text-sm hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40"
              >
                Render Mixdown
              </button>
            </>
          )}

          {phase === 'done' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 border border-gray-700 text-gray-400 rounded-lg text-sm hover:bg-gray-800">
                Close
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 py-2 bg-green-600 text-white font-semibold rounded-lg text-sm hover:bg-green-500"
              >
                ↓ Download WAV
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 border border-gray-700 text-gray-400 rounded-lg text-sm">Cancel</button>
              <button onClick={handleRender} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500">Retry</button>
            </>
          )}

          {phase === 'rendering' && (
            <div className="flex-1 py-2 text-center text-xs text-gray-500">Rendering… please wait</div>
          )}
        </div>
      </div>
    </div>
  );
}
