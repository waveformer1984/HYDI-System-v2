/**
 * components/rezonate/shared/PadGrid.tsx
 *
 * Reusable 2×4 pad grid — pure display/interaction component decoupled from
 * audio logic. Mirrors the visual style of BeatBoxCapture's pad buttons.
 *
 * Layout: 8 pads rendered in a 4-column grid (2 rows × 4 columns).
 * Status colours match BeatBoxCapture conventions:
 *   idle      — gray-800, mic-gray label
 *   active    — violet-900 with violet-500 border (replaces "has-sample")
 *   recording — red pulse ring
 *   playing   — emerald-700
 *
 * If progressPct > 0 a progress bar is drawn at the top of the pad.
 * Long-press is simulated via onMouseDown/onTouchStart timers inside the grid
 * so the parent can remain unaware of timing details.
 */

import React, { useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PadGridItem {
  index: number;
  label: string;
  status: 'idle' | 'active' | 'recording' | 'playing';
  hasContent: boolean;
  isLooped?: boolean;
  /** 0-100; renders a coloured progress bar at the top of the pad when > 0. */
  progressPct?: number;
  durationLabel?: string;
}

export interface PadGridProps {
  pads: PadGridItem[];
  onPadTap: (index: number) => void;
  onLongPress?: (index: number) => void;
  disabled?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LONG_PRESS_MS = 500;

// ── Style helpers ─────────────────────────────────────────────────────────────

function padClasses(item: PadGridItem): string {
  const base =
    'relative flex flex-col items-center justify-center min-h-[80px] rounded-xl ' +
    'cursor-pointer select-none transition-colors duration-150 outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-violet-400';

  const loopRing =
    item.isLooped && item.status !== 'recording' ? 'ring-2 ring-violet-400' : '';

  switch (item.status) {
    case 'idle':
      return `${base} bg-gray-800 text-gray-400 hover:bg-gray-700`;
    case 'recording':
      return `${base} bg-gray-800 text-red-400 ring-4 ring-red-500 animate-pulse`;
    case 'active':
      return `${base} bg-violet-900 border border-violet-500 text-violet-200 ${loopRing}`;
    case 'playing':
      return `${base} bg-emerald-700 text-white ${loopRing}`;
  }
}

// ── Progress bar colour by status ─────────────────────────────────────────────

function progressColor(status: PadGridItem['status']): string {
  switch (status) {
    case 'recording': return 'bg-red-500';
    case 'playing':   return 'bg-emerald-400';
    default:          return 'bg-violet-500';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PadGrid({
  pads,
  onPadTap,
  onLongPress,
  disabled = false,
}: PadGridProps) {
  // Track long-press timers per pad index.
  const longPressTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const startLongPress = useCallback(
    (index: number) => {
      if (!onLongPress) return;
      const timer = setTimeout(() => {
        longPressTimers.current.delete(index);
        onLongPress(index);
      }, LONG_PRESS_MS);
      longPressTimers.current.set(index, timer);
    },
    [onLongPress]
  );

  const cancelLongPress = useCallback((index: number) => {
    const timer = longPressTimers.current.get(index);
    if (timer !== undefined) {
      clearTimeout(timer);
      longPressTimers.current.delete(index);
    }
  }, []);

  return (
    <div className="grid grid-cols-4 gap-3">
      {pads.map((item) => {
        const pct = item.progressPct ?? 0;

        return (
          <button
            key={item.index}
            className={`${padClasses(item)} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            disabled={disabled}
            onClick={() => onPadTap(item.index)}
            onMouseDown={() => startLongPress(item.index)}
            onMouseUp={() => cancelLongPress(item.index)}
            onMouseLeave={() => cancelLongPress(item.index)}
            onTouchStart={(e) => {
              e.preventDefault();
              startLongPress(item.index);
            }}
            onTouchEnd={() => cancelLongPress(item.index)}
            onTouchCancel={() => cancelLongPress(item.index)}
            aria-label={`Pad ${item.label}${item.hasContent ? ' — has content' : ''}`}
          >
            {/* Progress bar — only visible when progressPct > 0 */}
            {pct > 0 && (
              <div
                className={`absolute top-0 left-0 h-1 rounded-t-xl transition-all duration-100 ${progressColor(item.status)}`}
                style={{ width: `${pct}%` }}
              />
            )}

            {/* Pad label */}
            <span className="text-xs font-bold mb-1 opacity-70">{item.label}</span>

            {/* Status icon */}
            {item.status === 'idle' && (
              /* Microphone placeholder — matches BeatBoxCapture's MicIcon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-6 h-6 text-gray-400"
                aria-hidden="true"
              >
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm7 8a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-1.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
              </svg>
            )}

            {item.status === 'recording' && (
              <div className="w-4 h-4 rounded-full bg-red-500" />
            )}

            {(item.status === 'active' || item.status === 'playing') && (
              /* Waveform icon — matches BeatBoxCapture's WaveformIcon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`w-6 h-6 ${item.status === 'playing' ? 'text-emerald-200' : 'text-violet-300'}`}
                aria-hidden="true"
              >
                <path d="M2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm4-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8zm5-4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V4zm5 4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V8z" />
              </svg>
            )}

            {/* Duration / elapsed label */}
            {item.durationLabel && (
              <span
                className={`text-xs mt-1 ${
                  item.status === 'playing'
                    ? 'text-emerald-200'
                    : item.status === 'recording'
                    ? 'text-red-300'
                    : 'text-violet-300'
                }`}
              >
                {item.durationLabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
