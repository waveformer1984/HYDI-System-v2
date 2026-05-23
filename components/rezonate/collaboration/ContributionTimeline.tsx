/**
 * components/rezonate/collaboration/ContributionTimeline.tsx
 *
 * Ledger-backed view of who contributed what to a collaboration session.
 * Shows each contributor's avatar, name, recorded pad indices, event count,
 * and active time window. When a splitConfig is provided, renders a percentage
 * bar and projected payout per contributor.
 */

import React from 'react';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Contribution {
  userId: string;
  displayName: string;
  padIndices: number[];
  eventCount: number;
  joinedAt: string;     // ISO date string
  leftAt?: string | null;
}

export interface SplitConfig {
  userId: string;
  displayName: string;
  percentage: number;
}

export interface ContributionTimelineProps {
  contributions: Contribution[];
  splitConfig?: SplitConfig[];
  /** If provided, project payout per contributor from the split config. */
  totalRevenue?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Same palette as SessionPresence for visual consistency. */
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

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

function avatarColor(userId: string): string {
  return AVATAR_COLORS[hashString(userId) % AVATAR_COLORS.length];
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Formats an ISO date string as a short local time (HH:MM) for timeline display.
 * Returns an empty string on invalid input.
 */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Formats a currency value as USD with 2 decimal places.
 * e.g. formatUSD(12.5) → "$12.50"
 */
function formatUSD(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ── Sub-component: PadChip ────────────────────────────────────────────────────

interface PadChipProps {
  padIndex: number;
}

/** Small numbered chip representing a recorded pad index. */
function PadChip({ padIndex }: PadChipProps) {
  return (
    <span
      className={[
        'inline-flex items-center justify-center',
        'w-6 h-6 rounded-md text-xs font-bold',
        'bg-violet-900 text-violet-200 border border-violet-700',
      ].join(' ')}
      aria-label={`Pad ${padIndex + 1}`}
    >
      {padIndex + 1}
    </span>
  );
}

// ── Sub-component: ContributorRow ─────────────────────────────────────────────

interface ContributorRowProps {
  contribution: Contribution;
  split?: SplitConfig;
  totalRevenue?: number;
}

function ContributorRow({ contribution, split, totalRevenue }: ContributorRowProps) {
  const {
    userId,
    displayName,
    padIndices,
    eventCount,
    joinedAt,
    leftAt,
  } = contribution;

  const color = avatarColor(userId);
  const label = initials(displayName);
  const joinedTime = formatTime(joinedAt);
  const leftTime = leftAt ? formatTime(leftAt) : null;

  const projectedPayout =
    split && totalRevenue != null
      ? totalRevenue * (split.percentage / 100)
      : null;

  return (
    <div className="flex flex-col gap-2 p-4 bg-gray-800 rounded-xl border border-gray-700">
      {/* Top row: avatar + name + time range */}
      <div className="flex items-center gap-3">
        {/* Avatar circle */}
        <div
          className={[
            'w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center',
            'text-sm font-bold text-white select-none',
            color,
          ].join(' ')}
          aria-label={displayName}
        >
          {label}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{displayName}</p>
          <p className="text-xs text-gray-400">
            {joinedTime}
            {leftTime ? ` → ${leftTime}` : ' → now'}
          </p>
        </div>

        {/* Event count badge */}
        <div className="flex-shrink-0 text-right">
          <span className="text-xs text-gray-400">{eventCount.toLocaleString()} events</span>
        </div>
      </div>

      {/* Pad chips */}
      {padIndices.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label="Recorded pads">
          {padIndices.map((idx) => (
            <PadChip key={idx} padIndex={idx} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">No pads recorded</p>
      )}

      {/* Split/payout section */}
      {split ? (
        <div className="flex flex-col gap-1.5 mt-1">
          {/* Percentage bar */}
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-2 rounded-full bg-gray-700 overflow-hidden"
              role="progressbar"
              aria-valuenow={split.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${split.percentage}% share`}
            >
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-300"
                style={{ width: `${Math.min(split.percentage, 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-violet-300 flex-shrink-0 w-10 text-right">
              {split.percentage.toFixed(1)}%
            </span>
          </div>

          {/* Projected payout */}
          {projectedPayout != null && (
            <p className="text-xs text-emerald-400">
              Projected payout: <span className="font-semibold">{formatUSD(projectedPayout)}</span>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * ContributionTimeline
 *
 * Renders a vertical list of contributor records. If `splitConfig` is provided,
 * each matching contributor shows a percentage bar and (optionally) a projected
 * payout derived from `totalRevenue`. If no splitConfig is provided, shows an
 * "Auto-split" placeholder instead.
 */
export default function ContributionTimeline({
  contributions,
  splitConfig,
  totalRevenue,
}: ContributionTimelineProps) {
  // Build a lookup from userId → SplitConfig for O(1) access during render.
  const splitByUserId = React.useMemo<Record<string, SplitConfig>>(() => {
    if (!splitConfig) return {};
    return splitConfig.reduce<Record<string, SplitConfig>>((acc, s) => {
      acc[s.userId] = s;
      return acc;
    }, {});
  }, [splitConfig]);

  return (
    <div className="flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Contributions
        </h2>

        {/* Revenue split summary or placeholder */}
        {splitConfig ? (
          <span className="text-xs text-gray-500">
            {totalRevenue != null
              ? `Total: ${formatUSD(totalRevenue)}`
              : 'Revenue TBD'}
          </span>
        ) : (
          <span className="text-xs text-violet-400 italic">
            Auto-split based on contribution
          </span>
        )}
      </div>

      {/* Contributor list */}
      {contributions.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">
          No contributions recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Contributor list">
          {contributions.map((c) => (
            <li key={c.userId}>
              <ContributorRow
                contribution={c}
                split={splitByUserId[c.userId]}
                totalRevenue={totalRevenue}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
