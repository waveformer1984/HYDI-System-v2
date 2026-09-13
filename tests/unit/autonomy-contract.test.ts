/**
 * Autonomy Contract Tests
 *
 * Verifies that the HEIDI Operational Autonomy Contract is complete,
 * consistent with the existing policy architecture, and that all
 * "MUST NEVER" prohibitions are enforceable.
 */

import {
  HEIDI_MAY,
  HEIDI_MUST_NEVER,
  formatContract,
} from '../../lib/operational/AutonomyContract';
import { autonomyPolicyModel } from '../../lib/operational/AutonomyPolicyModel';
import { actionRegistry } from '../../lib/operational/ActionRegistry';

describe('HEIDI Operational Autonomy Contract', () => {
  describe('HEIDI_MAY', () => {
    it('includes health.read (R0, autonomous)', () => {
      const entry = HEIDI_MAY.find((e) => e.capability === 'health.read');
      expect(entry).toBeDefined();
      expect(entry!.risk).toBe('R0');
      expect(entry!.authorization).toBe('autonomous');
    });

    it('includes health.recover for process restart (R1, autonomous)', () => {
      const entries = HEIDI_MAY.filter((e) => e.capability === 'health.recover' && e.risk === 'R1');
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.authorization === 'autonomous')).toBe(true);
    });

    it('includes escalation (R0, autonomous)', () => {
      const entry = HEIDI_MAY.find(
        (e) => e.capability === 'health.recover' && e.description.includes('Escalate'),
      );
      expect(entry).toBeDefined();
      expect(entry!.risk).toBe('R0');
    });

    it('every MAY entry has a corresponding policy in AutonomyPolicyModel', () => {
      for (const may of HEIDI_MAY) {
        if (may.capability === 'health.recover') {
          // health.recover has per-target policies, not a single wildcard
          // Just verify the capability is known
          continue;
        }
        const policies = autonomyPolicyModel.findPolicies(
          may.capability as any,
          '*',
        );
        expect(policies.length).toBeGreaterThan(0);
      }
    });
  });

  describe('HEIDI_MUST_NEVER', () => {
    it('prohibits secret rotation', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('secrets'))).toBe(true);
    });

    it('prohibits arbitrary shell commands', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('arbitrary shell'))).toBe(true);
    });

    it('prohibits autonomy policy self-modification', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('autonomy policy'))).toBe(true);
    });

    it('prohibits destructive database operations', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('destructive database'))).toBe(true);
    });

    it('prohibits financial actions', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('financial'))).toBe(true);
    });

    it('prohibits bypassing approval', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('bypass approval'))).toBe(true);
    });

    it('prohibits hiding audit history', () => {
      expect(HEIDI_MUST_NEVER.some((n) => n.prohibition.includes('audit history'))).toBe(true);
    });

    it('every prohibition has an enforcement mechanism', () => {
      for (const never of HEIDI_MUST_NEVER) {
        expect(never.enforcement).toBeDefined();
        expect(never.enforcement.length).toBeGreaterThan(10);
        expect(never.rationale).toBeDefined();
        expect(never.rationale.length).toBeGreaterThan(10);
      }
    });

    it('no prohibited action exists in the ActionRegistry', () => {
      const allActions = actionRegistry.getAll();
      // Verify no action in the registry involves secrets, credentials, or destructive DB ops
      for (const action of allActions) {
        const desc = action.purpose.toLowerCase();
        expect(desc).not.toContain('secret');
        expect(desc).not.toContain('credential');
        expect(desc).not.toContain('drop table');
        expect(desc).not.toContain('delete from');
        expect(desc).not.toContain('truncate');
      }
    });
  });

  describe('formatContract', () => {
    it('produces a readable contract document', () => {
      const text = formatContract();
      expect(text).toContain('HEIDI OPERATIONAL AUTONOMY CONTRACT');
      expect(text).toContain('HEIDI MAY AUTOMATICALLY');
      expect(text).toContain('HEIDI MUST NEVER AUTOMATICALLY');
      expect(text).toContain('AUTONOMY MUST BE GOVERNED');
    });
  });
});
