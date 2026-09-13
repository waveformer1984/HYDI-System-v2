/**
 * The run_cycle governance bypass.
 *
 * RevenueControlLoop calls ProspectPipeline and CustomerLifecycle methods
 * directly rather than dispatching through the capability registry. One
 * authorization of `revenue.run_cycle` therefore used to admit every write
 * inside the cycle — none of which any sub-capability contract ever saw, even
 * though contracts existed for most of them.
 *
 * These tests assert the seam that closes it, and — just as importantly — that
 * the absence of a governor is recorded rather than silently permitted.
 */

import { RevenueControlLoop } from '../../lib/revenue/RevenueControlLoop';
import type { CapabilityGovernor } from '../../lib/revenue/RevenueControlLoop';
import { ALL_CONTRACTS } from '../../lib/heidi/contracts';

/** Reach the private helper without pretending the whole loop is unit-testable. */
function governedOf(loop: RevenueControlLoop) {
  return (
    loop as unknown as {
      governed: <T>(
        id: string,
        args: Record<string, unknown>,
        op: () => Promise<T>,
      ) => Promise<{ ok: true; value: T } | { ok: false; reason: string }>;
    }
  ).governed.bind(loop);
}

describe('revenue writes are governed per operation', () => {
  it('routes an operation through its own contract before running it', async () => {
    const loop = new RevenueControlLoop();
    const asked: string[] = [];
    const governor: CapabilityGovernor = async (capabilityId) => {
      asked.push(capabilityId);
      return { allowed: true, reason: 'test-allow' };
    };
    loop.setGovernor(governor);

    let ran = false;
    const result = await governedOf(loop)('revenue.update_prospect_status', {}, async () => {
      ran = true;
      return 'done';
    });

    expect(asked).toEqual(['revenue.update_prospect_status']);
    expect(ran).toBe(true);
    expect(result).toEqual({ ok: true, value: 'done' });
    expect(loop.getGovernanceLog()).toEqual([
      { capabilityId: 'revenue.update_prospect_status', allowed: true, ungoverned: false, reason: 'test-allow' },
    ]);
  });

  it('does not run the write when the governor refuses', async () => {
    const loop = new RevenueControlLoop();
    loop.setGovernor(async () => ({ allowed: false, reason: 'R4 requires approval' }));

    let ran = false;
    const result = await governedOf(loop)('revenue.create_opportunity', {}, async () => {
      ran = true;
      return 'should not happen';
    });

    // The point of returning a refusal rather than throwing: callers must
    // handle it explicitly instead of proceeding with an unauthorized write.
    expect(ran).toBe(false);
    expect(result).toEqual({ ok: false, reason: 'R4 requires approval' });
    expect(loop.getGovernanceLog()[0].allowed).toBe(false);
  });

  it('records an ungoverned write instead of permitting it silently', async () => {
    // No governor supplied. The write still happens — this follows the same
    // advisory-then-enforcing progression as HEIDI_CONTRACT_AUTHORITY — but it
    // is marked, so the bypass cannot quietly return.
    const loop = new RevenueControlLoop();

    const result = await governedOf(loop)('revenue.score_prospect', {}, async () => 'scored');

    expect(result).toEqual({ ok: true, value: 'scored' });
    const log = loop.getGovernanceLog();
    expect(log).toHaveLength(1);
    expect(log[0].ungoverned).toBe(true);
    expect(log[0].reason).toContain('without contract authorization');
  });

  it('has a contract for every capability the loop governs', () => {
    // The fix revealed two operations with no contract at all — they were not
    // weakly verified, they were invisible. If a new mutation is added to the
    // loop without a contract, this fails.
    const governed = [
      'revenue.score_prospect',
      'revenue.update_prospect_status',
      'revenue.create_opportunity',
      'revenue.start_provisioning',
      'revenue.update_health_status',
    ];
    const known = new Set(ALL_CONTRACTS.map((c) => c.identity.id));
    for (const id of governed) {
      expect({ id, registered: known.has(id) }).toEqual({ id, registered: true });
    }
  });
});
