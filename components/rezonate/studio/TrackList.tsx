/**
 * components/rezonate/studio/TrackList.tsx
 *
 * Scrollable list of project tracks. Each row shows:
 *   - A color-coded type badge (audio / midi / instrument)
 *   - Track name
 *   - Mute (M) and Solo (S) toggle buttons
 *   - Horizontal volume range input (0–100)
 *   - Pan display with decrement/increment controls (-50 to +50)
 *
 * An "Add Track" button appears at the bottom when onAddTrack is provided.
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Track {
  id: string;
  name: string;
  type: 'audio' | 'midi' | 'instrument';
  muted: boolean;
  solo: boolean;
  volume: number;  // 0–100
  pan: number;     // -50 to +50
}

export interface TrackListProps {
  tracks: Track[];
  onMute: (id: string, muted: boolean) => void;
  onSolo: (id: string, solo: boolean) => void;
  onVolumeChange: (id: string, vol: number) => void;
  onPanChange: (id: string, pan: number) => void;
  onAddTrack?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<Track['type'], { label: string; classes: string }> = {
  audio:      { label: 'AUD', classes: 'bg-violet-900 text-violet-300 border border-violet-600' },
  midi:       { label: 'MID', classes: 'bg-emerald-900 text-emerald-300 border border-emerald-600' },
  instrument: { label: 'INS', classes: 'bg-sky-900 text-sky-300 border border-sky-600' },
};

const PAN_STEP = 1;
const PAN_MIN = -50;
const PAN_MAX = 50;
const VOL_MIN = 0;
const VOL_MAX = 100;

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrackList({
  tracks,
  onMute,
  onSolo,
  onVolumeChange,
  onPanChange,
  onAddTrack,
}: TrackListProps) {
  return (
    <div className="flex flex-col gap-1">
      {tracks.map((track) => {
        const badge = TYPE_BADGE[track.type];

        return (
          <div
            key={track.id}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-800 border ${
              track.solo ? 'border-yellow-600' : track.muted ? 'border-gray-700 opacity-50' : 'border-gray-700'
            } transition-opacity duration-100`}
          >
            {/* Type badge */}
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-bold ${badge.classes}`}
            >
              {badge.label}
            </span>

            {/* Track name */}
            <span className="flex-1 truncate text-sm text-gray-200 font-medium min-w-0">
              {track.name}
            </span>

            {/* Mute button */}
            <button
              onClick={() => onMute(track.id, !track.muted)}
              className={`shrink-0 w-6 h-6 rounded text-xs font-bold transition-colors ${
                track.muted
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
              aria-pressed={track.muted}
            >
              M
            </button>

            {/* Solo button */}
            <button
              onClick={() => onSolo(track.id, !track.solo)}
              className={`shrink-0 w-6 h-6 rounded text-xs font-bold transition-colors ${
                track.solo
                  ? 'bg-yellow-500 text-gray-900'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              aria-label={`${track.solo ? 'Unsolo' : 'Solo'} ${track.name}`}
              aria-pressed={track.solo}
            >
              S
            </button>

            {/* Volume slider */}
            <label className="shrink-0 flex items-center gap-1">
              <span className="text-xs text-gray-500 w-3">V</span>
              <input
                type="range"
                min={VOL_MIN}
                max={VOL_MAX}
                value={track.volume}
                onChange={(e) => onVolumeChange(track.id, Number(e.target.value))}
                className="w-16 accent-violet-500"
                aria-label={`Volume for ${track.name}`}
              />
            </label>

            {/* Pan control */}
            <div className="shrink-0 flex items-center gap-1">
              <button
                onClick={() =>
                  onPanChange(track.id, Math.max(PAN_MIN, track.pan - PAN_STEP))
                }
                className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs flex items-center justify-center"
                aria-label={`Pan left for ${track.name}`}
              >
                −
              </button>
              <span className="w-8 text-center text-xs font-mono text-gray-300">
                {track.pan === 0 ? 'C' : track.pan > 0 ? `+${track.pan}` : String(track.pan)}
              </span>
              <button
                onClick={() =>
                  onPanChange(track.id, Math.min(PAN_MAX, track.pan + PAN_STEP))
                }
                className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs flex items-center justify-center"
                aria-label={`Pan right for ${track.name}`}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {/* Add Track button */}
      {onAddTrack && (
        <button
          onClick={onAddTrack}
          className="mt-2 w-full py-2 rounded-lg border border-dashed border-gray-600 text-gray-500 hover:border-violet-600 hover:text-violet-400 text-sm font-medium transition-colors"
          aria-label="Add new track"
        >
          + Add Track
        </button>
      )}
    </div>
  );
}
