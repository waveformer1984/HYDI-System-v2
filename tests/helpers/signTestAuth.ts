/**
 * Test helper — mint a signed ActionAuthorization for the authorization
 * provenance contract.
 *
 * Authorization is now verifiably bound to (approvedBy | approvalRef |
 * grantedAt | actionType | sessionId | payloadDigest). A test that exercises
 * the authorized path can no longer hand the chokepoint a bare object — it
 * must produce a signature, exactly as the real approval path does.
 *
 * The signing key here is a TEST-ONLY secret. Setting it in-process does not
 * touch any real credential store and never reaches a production
 * authorization, because a production signature is minted over the same
 * fields with the real HYDI_APPROVAL_SECRET — a different key, so a test
 * signature is not replayable against production.
 */
import { signAuthorization, payloadDigest } from '../../lib/governance/approval-signing';
import type { ActionAuthorization } from '../../lib/governance/ActionChokepoint';

const TEST_SIGNING_KEY = 'hydi-test-approval-secret';

// Ensure a signing key exists for the whole test run. If a real key is
// already configured it is left alone.
if (!process.env.HYDI_APPROVAL_SECRET && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.HYDI_APPROVAL_SECRET = TEST_SIGNING_KEY;
}

export interface MintAuthOptions {
  /** The action type the approval authorizes — bound into the signature. */
  type: string;
  /** The session the action runs in — bound into the signature. */
  sessionId?: string;
  /** The action payload — digested and bound into the signature. */
  payload?: Record<string, unknown>;
  approvedBy?: string;
  approvalRef?: string;
  grantedAt?: string;
}

/**
 * Return a well-formed, correctly-signed ActionAuthorization for the given
 * action identity. Use this wherever a test needs the AUTHORIZED branch of
 * the chokepoint rather than the denial branch.
 */
export function mintSignedAuthorization(opts: MintAuthOptions): ActionAuthorization {
  const base = {
    approvedBy: opts.approvedBy ?? 'user:owner',
    approvalRef: opts.approvalRef ?? `test-approval-${opts.type}`,
    grantedAt: opts.grantedAt ?? new Date().toISOString(),
  };
  const signature = signAuthorization(base, opts.type, opts.sessionId, payloadDigest(opts.payload));
  if (!signature) {
    throw new Error('mintSignedAuthorization: no signing key available in test env');
  }
  return { ...base, signature };
}
