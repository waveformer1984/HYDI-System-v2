/**
 * executor-env-gates — the hard env override at the executor seam.
 * These executors can commit code (dev_patch / dev_author HIGH) or create
 * paid checkout sessions (advance_offer). The daemon's pooled-resolver
 * bounds never reach them, so the env gate is the fail-closed control.
 */
import { devPatchEnabled, revenueAdvanceEnabled, shouldAutoApplyPatch, GATE_DEV_PATCH_DISABLED, GATE_REVENUE_ADVANCE_DISABLED } from '../../lib/heidi/executor-env-gates';

describe('executor env gates', () => {
  const ENV_KEYS = ['HEIDI_ALLOW_DEV_PATCH', 'HEIDI_ALLOW_REVENUE_ADVANCE'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('ops.dev_patch is refused unless HEIDI_ALLOW_DEV_PATCH is exactly "true"', () => {
    expect(devPatchEnabled()).toBe(false);
    process.env.HEIDI_ALLOW_DEV_PATCH = '1';
    expect(devPatchEnabled()).toBe(false);
    process.env.HEIDI_ALLOW_DEV_PATCH = 'TRUE';
    expect(devPatchEnabled()).toBe(false);
    process.env.HEIDI_ALLOW_DEV_PATCH = 'true';
    expect(devPatchEnabled()).toBe(true);
  });

  it('revenue.advance_offer is refused unless HEIDI_ALLOW_REVENUE_ADVANCE is exactly "true"', () => {
    expect(revenueAdvanceEnabled()).toBe(false);
    process.env.HEIDI_ALLOW_REVENUE_ADVANCE = 'yes';
    expect(revenueAdvanceEnabled()).toBe(false);
    process.env.HEIDI_ALLOW_REVENUE_ADVANCE = 'true';
    expect(revenueAdvanceEnabled()).toBe(true);
  });

  it('ops.dev_author HIGH confidence produces a human action, not a commit, when the gate is closed', () => {
    expect(shouldAutoApplyPatch('HIGH')).toBe(false);   // env unset -> human action path
    expect(shouldAutoApplyPatch('MEDIUM')).toBe(false);
    process.env.HEIDI_ALLOW_DEV_PATCH = 'true';
    expect(shouldAutoApplyPatch('HIGH')).toBe(true);     // only HIGH + env open auto-applies
    expect(shouldAutoApplyPatch('MEDIUM')).toBe(false);
  });

  it('gate codes are distinct per executor', () => {
    expect(GATE_DEV_PATCH_DISABLED).not.toBe(GATE_REVENUE_ADVANCE_DISABLED);
  });
});
