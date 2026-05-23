/**
 * components/rezonate/transport/TransportBar.tsx
 *
 * BPM control + play/stop bar. Mirrors the transport row layout found inside
 * BeatBoxCapture: decrement/increment BPM buttons, a centred BPM readout,
 * a TAP tempo button, and a PLAY/STOP toggle.
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransportBarProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
  onTap: () => void;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  /** Minimum BPM — defaults to 60. */
  minBpm?: number;
  /** Maximum BPM — defaults to 200. */
  maxBpm?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransportBar({
  bpm,
  onBpmChange,
  onTap,
  isPlaying,
  onPlay,
  onStop,
  minBpm = 60,
  maxBpm = 200,
}: TransportBarProps) {
  const decrement = () => onBpmChange(Math.max(minBpm, bpm - 1));
  const increment = () => onBpmChange(Math.min(maxBpm, bpm + 1));

  return (
    <div className="flex items-center gap-2">
      {/* BPM decrement */}
      <button
        onClick={decrement}
        className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold flex items-center justify-center text-lg leading-none transition-colors"
        aria-label="Decrease BPM"
      >
        −
      </button>

      {/* BPM readout */}
      <div className="flex-1 text-center">
        <span className="text-white font-mono font-bold text-sm">{bpm}</span>
        <span className="text-gray-400 text-xs ml-1">BPM</span>
      </div>

      {/* BPM increment */}
      <button
        onClick={increment}
        className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold flex items-center justify-center text-lg leading-none transition-colors"
        aria-label="Increase BPM"
      >
        +
      </button>

      {/* Tap tempo */}
      <button
        onClick={onTap}
        className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white text-xs font-medium transition-colors"
        aria-label="Tap tempo"
      >
        TAP
      </button>

      {/* Play / Stop toggle */}
      <button
        onClick={isPlaying ? onStop : onPlay}
        className={`px-4 py-1.5 rounded-lg text-white text-xs font-bold transition-colors ${
          isPlaying
            ? 'bg-red-600 hover:bg-red-500'
            : 'bg-emerald-600 hover:bg-emerald-500'
        }`}
        aria-label={isPlaying ? 'Stop playback' : 'Start playback'}
      >
        {isPlaying ? '■ STOP' : '▶ PLAY'}
      </button>
    </div>
  );
}
