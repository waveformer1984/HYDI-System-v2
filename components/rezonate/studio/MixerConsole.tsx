/**
 * components/rezonate/studio/MixerConsole.tsx
 *
 * Horizontal-scrolling mixer console with vertical faders.
 *
 * Layout: channel strips scroll horizontally. Each strip has:
 *   - Colored top accent (channel.color or violet default)
 *   - Vertical range input as fader (volume 0-100)
 *   - Pan knob display with −/+ step controls
 *   - Mute (M) button
 *   - Channel label at the bottom
 *
 * A Master channel is rendered to the right of a separator line, showing the
 * same fader interface driven by masterVolume / onMasterVolumeChange.
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MixerChannel {
  id: string;
  label: string;
  volume: number;  // 0–100
  pan: number;     // -50 to +50
  muted: boolean;
  color?: string;
}

export interface MixerConsoleProps {
  channels: MixerChannel[];
  masterVolume: number;
  onChannelChange: (id: string, updates: Partial<MixerChannel>) => void;
  onMasterVolumeChange: (vol: number) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_COLOR = '#8b5cf6'; // violet-500
const PAN_STEP = 1;
const PAN_MIN = -50;
const PAN_MAX = 50;

// ── Sub-components ────────────────────────────────────────────────────────────

interface ChannelStripProps {
  label: string;
  volume: number;
  pan: number;
  muted: boolean;
  accentColor: string;
  onVolumeChange: (v: number) => void;
  onPanChange: (p: number) => void;
  onMuteToggle: () => void;
  isMaster?: boolean;
}

function ChannelStrip({
  label,
  volume,
  pan,
  muted,
  accentColor,
  onVolumeChange,
  onPanChange,
  onMuteToggle,
  isMaster = false,
}: ChannelStripProps) {
  return (
    <div
      className={`flex flex-col items-center w-16 bg-gray-800 rounded-lg overflow-hidden transition-opacity duration-100 ${
        muted && !isMaster ? 'opacity-50' : ''
      }`}
    >
      {/* Colored top accent bar */}
      <div
        className="w-full h-1 shrink-0"
        style={{ background: accentColor }}
      />

      {/* Fader area */}
      <div className="flex flex-col items-center gap-2 px-2 py-3 flex-1">
        {/* Vertical fader — uses writing-mode vertical via transform hack */}
        <div className="flex items-center justify-center h-24">
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="accent-violet-500"
            style={{
              writingMode: 'vertical-lr',
              direction: 'rtl',
              width: '32px',
              height: '96px',
            }}
            aria-label={`Volume for ${label}`}
          />
        </div>

        {/* Volume readout */}
        <span className="text-xs font-mono text-gray-400">{volume}</span>

        {/* Pan control */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onPanChange(Math.max(PAN_MIN, pan - PAN_STEP))}
            className="w-4 h-4 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs flex items-center justify-center"
            aria-label={`Pan ${label} left`}
          >
            −
          </button>
          <span className="w-6 text-center text-xs font-mono text-gray-400">
            {pan === 0 ? 'C' : pan > 0 ? `R${pan}` : `L${Math.abs(pan)}`}
          </span>
          <button
            onClick={() => onPanChange(Math.min(PAN_MAX, pan + PAN_STEP))}
            className="w-4 h-4 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs flex items-center justify-center"
            aria-label={`Pan ${label} right`}
          >
            +
          </button>
        </div>

        {/* Mute button — not shown on master */}
        {!isMaster && (
          <button
            onClick={onMuteToggle}
            className={`w-8 h-5 rounded text-xs font-bold transition-colors ${
              muted
                ? 'bg-orange-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
            aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
            aria-pressed={muted}
          >
            M
          </button>
        )}
      </div>

      {/* Channel label at the bottom */}
      <div
        className={`w-full py-1.5 text-center text-xs font-medium truncate px-1 ${
          isMaster ? 'text-white' : 'text-gray-400'
        }`}
        title={label}
      >
        {label}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MixerConsole({
  channels,
  masterVolume,
  onChannelChange,
  onMasterVolumeChange,
}: MixerConsoleProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-2 min-w-max p-2">
        {/* Channel strips */}
        {channels.map((ch) => (
          <ChannelStrip
            key={ch.id}
            label={ch.label}
            volume={ch.volume}
            pan={ch.pan}
            muted={ch.muted}
            accentColor={ch.color ?? DEFAULT_COLOR}
            onVolumeChange={(v) => onChannelChange(ch.id, { volume: v })}
            onPanChange={(p) => onChannelChange(ch.id, { pan: p })}
            onMuteToggle={() => onChannelChange(ch.id, { muted: !ch.muted })}
          />
        ))}

        {/* Separator */}
        <div className="self-stretch w-px bg-gray-600 mx-1 shrink-0" />

        {/* Master channel */}
        <ChannelStrip
          label="Master"
          volume={masterVolume}
          pan={0}
          muted={false}
          accentColor="#e2e8f0" // slate-200
          onVolumeChange={onMasterVolumeChange}
          onPanChange={() => {
            /* Master pan not supported */
          }}
          onMuteToggle={() => {
            /* Master mute not supported */
          }}
          isMaster
        />
      </div>
    </div>
  );
}
