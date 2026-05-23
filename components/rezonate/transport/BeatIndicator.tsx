/**
 * components/rezonate/transport/BeatIndicator.tsx
 *
 * 4-dot beat visualiser. Mirrors the beat indicator row inside BeatBoxCapture.
 *
 * Visual states:
 *   Stopped (currentBeat === -1): all dots dim gray-700.
 *   Playing: the active beat dot is lit violet. The downbeat (index 0) is
 *   slightly larger (scale-150) to mark the bar start.
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BeatIndicatorProps {
  /** -1 when stopped, 0-3 when playing (or 0 to beatsPerBar-1). */
  currentBeat: number;
  /** Number of beats per bar — defaults to 4. */
  beatsPerBar?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BeatIndicator({
  currentBeat,
  beatsPerBar = 4,
}: BeatIndicatorProps) {
  return (
    <div className="flex justify-center gap-3" aria-hidden="true">
      {Array.from({ length: beatsPerBar }).map((_, i) => {
        const isActive = currentBeat === i;
        const isDownbeat = i === 0;

        let dotClasses = 'rounded-full transition-all duration-75 ';

        if (isActive) {
          // Active downbeat is larger than other active beats.
          dotClasses += isDownbeat
            ? 'w-2.5 h-2.5 bg-violet-400 scale-150'
            : 'w-2.5 h-2.5 bg-violet-300 scale-125';
        } else {
          dotClasses += 'w-2.5 h-2.5 bg-gray-700';
        }

        return <div key={i} className={dotClasses} />;
      })}
    </div>
  );
}
