/**
 * components/rezonate/shared/ProjectCard.tsx
 *
 * Card component for listing Rezonate projects. Displays project name, status
 * badge, track count, and a relative updated-at timestamp.
 *
 * Visual states:
 *   active   — violet accent border + violet badge
 *   draft    — gray border + gray badge
 *   archived — muted gray, reduced opacity
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectCardProps {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  trackCount?: number;
  updatedAt?: string;
  onClick?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable relative time string given an ISO-8601 date string.
 * Falls back to the raw string if Date parsing fails.
 */
function relativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// ── Badge config ──────────────────────────────────────────────────────────────

const BADGE_CLASSES: Record<ProjectCardProps['status'], string> = {
  active:   'bg-violet-800 text-violet-200 border border-violet-500',
  draft:    'bg-gray-700 text-gray-400 border border-gray-600',
  archived: 'bg-gray-800 text-gray-600 border border-gray-700',
};

const BADGE_LABELS: Record<ProjectCardProps['status'], string> = {
  active:   'Active',
  draft:    'Draft',
  archived: 'Archived',
};

// ── Card container styles ─────────────────────────────────────────────────────

function cardClasses(status: ProjectCardProps['status']): string {
  const base =
    'group flex flex-col gap-3 rounded-xl p-4 cursor-pointer select-none ' +
    'transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ' +
    'border';

  switch (status) {
    case 'active':
      return `${base} bg-gray-800 border-violet-700 hover:brightness-110`;
    case 'draft':
      return `${base} bg-gray-800 border-gray-700 hover:brightness-110`;
    case 'archived':
      return `${base} bg-gray-850 border-gray-800 opacity-60 hover:opacity-80`;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProjectCard({
  name,
  status,
  trackCount,
  updatedAt,
  onClick,
}: ProjectCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cardClasses(status)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.();
      }}
      aria-label={`Open project ${name}`}
    >
      {/* Name + status badge row */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={`font-semibold text-sm leading-snug ${
            status === 'archived' ? 'text-gray-500' : 'text-white'
          }`}
        >
          {name}
        </span>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[status]}`}
        >
          {BADGE_LABELS[status]}
        </span>
      </div>

      {/* Track count + updated-at row */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {typeof trackCount === 'number'
            ? `${trackCount} track${trackCount !== 1 ? 's' : ''}`
            : 'No tracks'}
        </span>

        {updatedAt && (
          <span title={updatedAt}>{relativeTime(updatedAt)}</span>
        )}
      </div>
    </div>
  );
}
