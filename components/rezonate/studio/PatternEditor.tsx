/**
 * components/rezonate/studio/PatternEditor.tsx
 *
 * 16-step drum pattern grid.
 *
 * Layout: tracks as rows, 16 step buttons per row. Steps are visually grouped
 * in sets of 4 (quarter-note beats) separated by thin gaps. The currently
 * playing step column is highlighted in emerald. Active steps are violet.
 *
 * No internal state — all step data and toggle callbacks come from the parent.
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PatternEditorProps {
  /** steps[trackIndex][stepIndex] — 16 steps per track. */
  steps: boolean[][];
  trackLabels: string[];
  onToggle: (trackIndex: number, stepIndex: number) => void;
  /** -1 = not playing; 0–15 = currently active step column. */
  currentStep?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 16;
const GROUP_SIZE = 4;

// ── Step button style ─────────────────────────────────────────────────────────

function stepClasses(active: boolean, isCurrent: boolean): string {
  const base = 'h-8 rounded transition-colors duration-75 border';

  if (isCurrent && active) {
    // Current + active: emerald with slightly brighter border.
    return `${base} bg-emerald-500 border-emerald-400`;
  }
  if (isCurrent) {
    // Current column, step not toggled: emerald dim.
    return `${base} bg-emerald-900 border-emerald-700`;
  }
  if (active) {
    // Toggled step: violet.
    return `${base} bg-violet-600 border-violet-400 hover:bg-violet-500`;
  }
  // Idle: dark gray.
  return `${base} bg-gray-700 border-gray-600 hover:bg-gray-600`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PatternEditor({
  steps,
  trackLabels,
  onToggle,
  currentStep = -1,
}: PatternEditorProps) {
  const numTracks = trackLabels.length;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Step number header */}
        <div className="flex items-center mb-1 ml-20 gap-1">
          {Array.from({ length: TOTAL_STEPS }).map((_, stepIdx) => {
            // Insert a gap spacer before every group after the first.
            const isGroupStart = stepIdx > 0 && stepIdx % GROUP_SIZE === 0;
            return (
              <React.Fragment key={stepIdx}>
                {isGroupStart && <div className="w-1.5" />}
                <div className="w-8 text-center text-xs text-gray-600 font-mono">
                  {stepIdx + 1}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Track rows */}
        {Array.from({ length: numTracks }).map((_, trackIdx) => {
          const trackSteps = steps[trackIdx] ?? [];

          return (
            <div key={trackIdx} className="flex items-center gap-1 mb-1">
              {/* Track label */}
              <div
                className="w-20 shrink-0 truncate text-xs text-gray-400 font-medium pr-2 text-right"
                title={trackLabels[trackIdx]}
              >
                {trackLabels[trackIdx]}
              </div>

              {/* Step buttons */}
              {Array.from({ length: TOTAL_STEPS }).map((_, stepIdx) => {
                const active = trackSteps[stepIdx] ?? false;
                const isCurrent = currentStep === stepIdx;
                const isGroupStart = stepIdx > 0 && stepIdx % GROUP_SIZE === 0;

                return (
                  <React.Fragment key={stepIdx}>
                    {/* Beat group separator gap */}
                    {isGroupStart && <div className="w-1.5" />}

                    <button
                      className={`w-8 ${stepClasses(active, isCurrent)}`}
                      onClick={() => onToggle(trackIdx, stepIdx)}
                      aria-label={`${trackLabels[trackIdx]} step ${stepIdx + 1} — ${active ? 'on' : 'off'}`}
                      aria-pressed={active}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
