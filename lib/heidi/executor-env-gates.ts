/**
 * Hard env gates for executors that can commit code or create paid sessions.
 * The authority-bounds table (heidi_decision_bounds) gates only the daemon's
 * pooled resolver cadence — wired executors in CognitiveCore run outside it.
 * These env switches are the fail-closed override for the executor seam:
 * anything but the exact string 'true' refuses.
 */

export const GATE_DEV_PATCH_DISABLED = 'DEV_PATCH_DISABLED';
export const GATE_REVENUE_ADVANCE_DISABLED = 'REVENUE_ADVANCE_DISABLED';

export function devPatchEnabled(): boolean {
  return process.env.HEIDI_ALLOW_DEV_PATCH === 'true';
}

export function revenueAdvanceEnabled(): boolean {
  return process.env.HEIDI_ALLOW_REVENUE_ADVANCE === 'true';
}

/**
 * ops.dev_author auto-applies only at HIGH confidence AND with the env gate
 * open. Any other combination files the proposal as a human action — the
 * same path non-HIGH confidence already takes.
 */
export function shouldAutoApplyPatch(confidence: string): boolean {
  return confidence === 'HIGH' && devPatchEnabled();
}
