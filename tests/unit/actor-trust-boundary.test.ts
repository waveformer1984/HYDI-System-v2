/**
 * Actor trust boundary (R2 contract item 3).
 *
 * The red team demonstrated that `request.actor` — a caller-supplied string —
 * was used to derive `isAutonomous`, so claiming a non-heidi actor turned an
 * autonomous action into a "human-initiated" one and bypassed R3/R4/R5.
 *
 * The fix: caller-provided identity is data, not authentication. This layer is
 * the autonomous-agent communication boundary, so `isAutonomous` is always
 * true — no actor string can downgrade the risk tier. A real human
 * authorization originates from a trusted approval mechanism (the signed
 * approval path), never from a string the caller asserts.
 *
 * Under test: authorizeAction must refuse R3/R4/R5 action types for EVERY
 * actor claim — omitted, empty, 'human', 'admin', 'operator', 'system',
 * 'heidi', 'mallory', and malformed values.
 */

import { CommunicationLayer } from '../../lib/communication/communicationLayer';
import type { CommunicationActionType } from '../../lib/communication/types';

const layer = new CommunicationLayer();

/** Every actor claim a caller might try, including malformed/non-string. */
const ACTOR_CLAIMS: Array<{ label: string; actor: unknown }> = [
  { label: 'omitted', actor: undefined },
  { label: 'empty string', actor: '' },
  { label: 'arbitrary', actor: 'mallory' },
  { label: '"human"', actor: 'human' },
  { label: '"admin"', actor: 'admin' },
  { label: '"operator"', actor: 'operator' },
  { label: '"system"', actor: 'system' },
  { label: '"heidi"', actor: 'heidi' },
  { label: '"user:owner"', actor: 'user:owner' },
  { label: 'number', actor: 42 },
  { label: 'object', actor: { role: 'admin' } },
  { label: 'null', actor: null },
];

/** Risk tiers that must NEVER be authorized for an autonomous caller. */
const RESTRICTED: Array<{ type: CommunicationActionType; tier: string }> = [
  { type: 'contractual_commitment', tier: 'R3' },
  { type: 'price_change', tier: 'R3' },
  { type: 'security_action', tier: 'R4' },
  { type: 'unrestricted_communication', tier: 'R5' },
];

describe('actor trust boundary — no actor claim bypasses R3/R4/R5', () => {
  for (const { type, tier } of RESTRICTED) {
    for (const { label, actor } of ACTOR_CLAIMS) {
      test(`${tier} ${type} is denied for actor=${label}`, () => {
        const ctx = layer.authorizeAction(type, {
          actor: actor as string,
          recipientId: 'recip-1',
          hasExistingRelationship: true,
          hasConsent: true, // consent granted — still must be denied
        });
        expect(ctx.authorized).toBe(false);
      });
    }
  }

  test('R0 acknowledge is still allowed for an autonomous actor (the gate is not a wall)', () => {
    const ctx = layer.authorizeAction('acknowledge', {
      actor: 'heidi',
      recipientId: 'recip-1',
      hasExistingRelationship: false,
      hasConsent: false,
    });
    expect(ctx.authorized).toBe(true);
  });

  test('the actor claim is still recorded for audit, just not trusted for the risk tier', () => {
    const ctx = layer.authorizeAction('contractual_commitment', {
      actor: 'operator',
      recipientId: 'recip-1',
      hasExistingRelationship: true,
      hasConsent: true,
    });
    expect(ctx.actor).toBe('operator'); // recorded verbatim
    expect(ctx.authorized).toBe(false); // but not trusted
  });
});
