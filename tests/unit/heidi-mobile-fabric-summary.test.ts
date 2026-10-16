import { summarizeFabricResult } from '../../lib/heidi-mobile/client/fabricSummary';

const taskId = 'aaaaaaaaaaaaaaaaaaaaaaaa';

describe('heidi mobile fabric summary', () => {
  it('does not treat executor acceptance as verified', () => {
    const summary = summarizeFabricResult({
      ok: true,
      accepted: true,
      task: { id: taskId, state: 'RUNNING', public_state: 'running', correlation_id: 'c1', verification: null },
    });
    expect(summary.disposition).toBe('accepted_unverified');
    expect(summary.verified).toBe(false);
    expect(summary.headline).toMatch(/not verified/i);
  });

  it('marks COMPLETED only when verification.verified is true', () => {
    const failed = summarizeFabricResult({
      ok: false,
      upstream_status: 502,
      task: { id: taskId, state: 'FAILED', public_state: 'failed', verification: { verified: false } },
    });
    expect(failed.verified).toBe(false);
    expect(failed.disposition).toBe('failed');

    const passed = summarizeFabricResult({
      ok: true,
      task: { id: taskId, state: 'COMPLETED', public_state: 'succeeded', correlation_id: 'c1', verification: { verified: true } },
    });
    expect(passed.verified).toBe(true);
    expect(passed.disposition).toBe('verified');
  });

  it('labels an idempotent replay as a duplicate, not a new success', () => {
    const summary = summarizeFabricResult({
      ok: true,
      duplicate: true,
      task: { id: taskId, state: 'COMPLETED', public_state: 'succeeded', verification: { verified: true } },
    });
    expect(summary.disposition).toBe('duplicate');
    expect(summary.duplicate).toBe(true);
    expect(summary.headline).toMatch(/no second run/i);
  });

  it('surfaces approval waits and rejections', () => {
    expect(summarizeFabricResult({ awaiting_approval: true, task: { id: taskId, state: 'AWAITING_APPROVAL', public_state: 'awaiting_approval' } }).disposition).toBe('pending_approval');
    expect(summarizeFabricResult({ error: 'unknown_capability' }).disposition).toBe('rejected');
    expect(summarizeFabricResult(null).disposition).toBe('unavailable');
  });
});
