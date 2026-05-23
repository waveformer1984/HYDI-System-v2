/**
 * components/rezonate/collaboration/SessionPresence.tsx
 *
 * Displays who is currently in a real-time collaboration session.
 * Renders avatar circles (initials, hashed color), a connection status dot,
 * and a "+N" overflow badge when more than 8 peers are present.
 * Each avatar shows a tooltip with the peer's full name and join time.
 */

import React, { useState, useId } from 'react';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Peer {
  userId: string;
  displayName: string;
  joinedAt: number; // unix ms
  isMe?: boolean;
}

export interface SessionPresenceProps {
  peers: Peer[];
  sessionName?: string;
  isConnected: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 8;

/**
 * A small palette of distinct background colors for avatars. We deterministically
 * pick one by hashing the userId so the same user always gets the same color.
 */
const AVATAR_COLORS = [
  'bg-violet-600',
  'bg-emerald-600',
  'bg-sky-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-fuchsia-600',
  'bg-lime-600',
  'bg-orange-600',
  'bg-teal-600',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a stable integer hash of a string, suitable for color-bucket selection.
 * Uses a simple djb2-style accumulator — not cryptographic, just deterministic.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/** Picks a Tailwind bg color class from AVATAR_COLORS based on userId. */
function avatarColor(userId: string): string {
  return AVATAR_COLORS[hashString(userId) % AVATAR_COLORS.length];
}

/** Extracts up to 2 initials from a display name. */
function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Returns a human-readable "X mins ago" string from a unix-ms timestamp. */
function minutesAgo(joinedAt: number): string {
  const diffMs = Date.now() - joinedAt;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

// ── Sub-component: Avatar ─────────────────────────────────────────────────────

interface AvatarProps {
  peer: Peer;
}

/**
 * Renders a single circular avatar with a hover tooltip.
 * The tooltip is pure CSS (no external libraries) using a data-tooltip attribute
 * pattern implemented via inline Tailwind group/peer utilities.
 */
function Avatar({ peer }: AvatarProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const color = avatarColor(peer.userId);
  const label = initials(peer.displayName);
  const joined = minutesAgo(peer.joinedAt);
  const tooltipText = `${peer.displayName}${peer.isMe ? ' (you)' : ''} · joined ${joined}`;

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      {/* Avatar circle */}
      <div
        role="img"
        aria-label={tooltipText}
        tabIndex={0}
        className={[
          'w-8 h-8 rounded-full flex items-center justify-center',
          'text-xs font-bold text-white select-none cursor-default',
          'ring-2 ring-gray-900 outline-none focus-visible:ring-violet-400',
          color,
          peer.isMe ? 'ring-violet-400' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {label}
      </div>

      {/* Tooltip — renders above the avatar, centered */}
      {tooltipVisible && (
        <div
          role="tooltip"
          className={[
            'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50',
            'whitespace-nowrap rounded-md px-2.5 py-1.5',
            'bg-gray-800 text-gray-100 text-xs shadow-lg border border-gray-700',
            'pointer-events-none',
          ].join(' ')}
        >
          {tooltipText}
          {/* Downward caret */}
          <span
            className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * SessionPresence
 *
 * Top-bar component showing who is in the current collaboration session.
 * - Up to 8 avatars are displayed; excess peers are collapsed into a "+N" badge.
 * - A green dot signals connected state; gray signals disconnected.
 * - The optional sessionName is shown in the center of the bar.
 */
export default function SessionPresence({
  peers,
  sessionName,
  isConnected,
}: SessionPresenceProps) {
  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, peers.length - MAX_VISIBLE);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800">
      {/* Connection status dot + label */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          aria-label={isConnected ? 'Connected' : 'Disconnected'}
          className={[
            'w-2 h-2 rounded-full flex-shrink-0',
            isConnected ? 'bg-green-400' : 'bg-gray-500',
          ].join(' ')}
        />
        <span className="text-xs text-gray-400 hidden sm:inline">
          {isConnected ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* Session name — centered, truncated */}
      {sessionName && (
        <p className="flex-1 text-sm font-medium text-white text-center truncate">
          {sessionName}
        </p>
      )}
      {!sessionName && <div className="flex-1" />}

      {/* Avatar stack */}
      <div className="flex items-center -space-x-2 flex-shrink-0">
        {visible.map((peer) => (
          <Avatar key={peer.userId} peer={peer} />
        ))}

        {/* Overflow badge — "+N more" */}
        {overflow > 0 && (
          <div
            aria-label={`${overflow} more participant${overflow === 1 ? '' : 's'}`}
            className={[
              'w-8 h-8 rounded-full flex items-center justify-center',
              'text-xs font-bold text-gray-300 bg-gray-700',
              'ring-2 ring-gray-900 cursor-default select-none',
            ].join(' ')}
          >
            +{overflow}
          </div>
        )}
      </div>

      {/* Peer count label */}
      <span className="text-xs text-gray-500 flex-shrink-0">
        {peers.length} {peers.length === 1 ? 'person' : 'people'}
      </span>
    </div>
  );
}
