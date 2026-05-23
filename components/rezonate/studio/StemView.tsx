/**
 * StemView — stacked waveform lanes for separated stems.
 * Each stem has mute/solo toggle, volume slider, and color-coded waveform.
 */
'use client';
import React, { useState, useCallback } from 'react';
import { WaveformDisplay } from './WaveformDisplay';

export interface Stem {
  id: string;
  name: string;
  buffer: AudioBuffer;
  color: string;
}

interface StemViewProps {
  stems: Stem[];
  isPlaying?: boolean;
  clockCurrentTime?: number;
  /** Called when mute/solo state changes — caller handles actual audio routing */
  onMuteChange?: (stemId: string, muted: boolean) => void;
  onSoloChange?: (stemId: string, soloed: boolean) => void;
  onVolumeChange?: (stemId: string, volume: number) => void;
  /** Replace a stem's buffer with a user-supplied file */
  onReplaceStem?: (stemId: string, blob: Blob, filename: string) => void;
}

const STEM_COLORS: Record<string, string> = {
  vocals: '#ec4899',
  drums:  '#f59e0b',
  bass:   '#10b981',
  other:  '#8b5cf6',
};

export function StemView({ stems, isPlaying, clockCurrentTime, onMuteChange, onSoloChange, onVolumeChange, onReplaceStem }: StemViewProps) {
  const [muteState, setMuteState] = useState<Record<string, boolean>>({});
  const [soloState, setSoloState] = useState<Record<string, boolean>>({});
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const toggleMute = useCallback((id: string) => {
    setMuteState(prev => {
      const next = { ...prev, [id]: !prev[id] };
      onMuteChange?.(id, next[id]);
      return next;
    });
  }, [onMuteChange]);

  const toggleSolo = useCallback((id: string) => {
    setSoloState(prev => {
      const next = { ...prev, [id]: !prev[id] };
      onSoloChange?.(id, next[id]);
      return next;
    });
  }, [onSoloChange]);

  const handleVolume = useCallback((id: string, v: number) => {
    setVolumes(prev => ({ ...prev, [id]: v }));
    onVolumeChange?.(id, v);
  }, [onVolumeChange]);

  const handleReplace = useCallback((id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onReplaceStem?.(id, file, file.name);
    e.target.value = '';
  }, [onReplaceStem]);

  if (stems.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-center text-gray-500 text-sm">
        No stems — run Stem Separation on a track to split into vocals / drums / bass / other
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl divide-y divide-gray-700">
      {stems.map(stem => {
        const color = STEM_COLORS[stem.name.toLowerCase()] ?? stem.color;
        const muted = muteState[stem.id] ?? false;
        const soloed = soloState[stem.id] ?? false;
        const volume = volumes[stem.id] ?? 80;
        const bufDur = stem.buffer.duration;

        return (
          <div key={stem.id} className="p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-white text-xs font-medium capitalize flex-1">{stem.name}</span>

              {/* Mute */}
              <button
                onClick={() => toggleMute(stem.id)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors
                  ${muted ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                M
              </button>

              {/* Solo */}
              <button
                onClick={() => toggleSolo(stem.id)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors
                  ${soloed ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                S
              </button>

              {/* Volume */}
              <input
                type="range" min={0} max={100} value={volume}
                onChange={e => handleVolume(stem.id, Number(e.target.value))}
                className="w-16 accent-violet-500"
              />
              <span className="text-gray-400 text-xs w-6 text-right">{volume}</span>

              {/* Replace */}
              <label className="cursor-pointer px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition-colors">
                ↑
                <input type="file" accept="audio/*" className="hidden" onChange={e => handleReplace(stem.id, e)} />
              </label>
            </div>

            {/* Waveform */}
            <div style={{ opacity: muted ? 0.3 : 1 }}>
              <WaveformDisplay
                audioBuffer={stem.buffer}
                color={color}
                height={48}
                clockCurrentTime={isPlaying ? clockCurrentTime : undefined}
                bufferDuration={bufDur}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
