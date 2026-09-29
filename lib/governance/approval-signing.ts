/**
 * Approval signing (Phase 3 R2).
 * ---------------------------------------------------------------------------
 * The hole this closes, measured 2026-09-18 (red-team):
 *
 *   ActionChokepoint.isValidAuthorization() accepted ANY object with three
 *   non-empty strings -- { approvedBy:'mallory', approvalRef:'fake',
 *   grantedAt:'...' } sailed through the gate for send_email. The fields were
 *   self-attested: nothing proved a human, or any approval record, stood
 *   behind them.
 *
 * The fix binds an authorization to its provenance AND to the action it
 * authorizes. When the genuine approval path (lib/action-approval.ts
 * resolvePendingAction) verifies a real pending `actions` row backed by a
 * real `decisions` row, it SIGNS the authorization over the tuple:
 *
 *     approvedBy | approvalRef | grantedAt | actionType | sessionId | payloadDigest
 *
 * The chokepoint recomputes the digest over the request it actually received
 * and compares. Any of the following therefore fails:
 *   - a fabricated object with no signature (missing)
 *   - a fabricated or altered signature (invalid / wrong)
 *   - an approval minted for a different action type, a different session, or
 *     a different payload -- the bound fields differ, so the digest differs
 *   - an approval replayed against a different approvalRef / approver
 *
 * Replay resistance: the signature is bound to `approvalRef` (the unique
 * `actions` row id of THIS approval) plus the action identity. Replaying the
 * same signed record onto a different action or a different approval is
 * rejected by the digest check. Replaying it against the SAME action is
 * idempotent by design -- a single approval legitimately authorizes one run
 * of the action it was minted for.
 *
 * What this does and does not do
 *   - It converts "fabricate a 3-string literal" into "produce a valid HMAC
 *     bound to THIS action in THIS session" -- a fabricated record fails.
 *   - A same-process caller who can import this module can mint a signature
 *     for anything. That is inherent to single-process governance and is a
 *     documented residual -- the supported way to obtain a signature is the
 *     verified-approval path, which itself now requires a real persisted
 *     ProtoForge decision record.
 *
 * Key: HYDI_APPROVAL_SECRET, falling back to SUPABASE_SERVICE_ROLE_KEY (which
 * the minting path already requires to reach Supabase). If neither is
 * configured, signing and verification both fail closed -- an approval that
 * cannot be verified is not an approval.
 */

import { createHmac, createHash, timingSafeEqual } from 'crypto';
import type { ActionAuthorization } from './ActionChokepoint';

function approvalKey(): string | null {
  const key = process.env.HYDI_APPROVAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key && key.length > 0 ? key : null;
}

/**
 * Recursively sort object keys at every depth so the canonical form is
 * independent of insertion order AND nested structure is fully bound. A
 * shallow `Object.keys().sort()` replacer array only whitelists top-level
 * keys -- nested objects serialize as `{}`, collapsing two payloads that
 * differ only inside a nested object to the SAME digest. That made an
 * approval replayable across nested-field changes. Sorting recursively
 * binds every nested key and value.
 */
function deepCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepCanonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = deepCanonicalize(src[key]);
    }
    return out;
  }
  return value;
}

/**
 * A deterministic digest of an action's payload. Key order is sorted at all
 * depths so the same payload always digests identically regardless of
 * property insertion order, and any change -- including inside a nested
 * object -- produces a different digest. Bound into the signature so an
 * approval cannot be replayed onto a different payload.
 */
export function payloadDigest(payload: Record<string, unknown> | undefined | null): string {
  const canonical = JSON.stringify(deepCanonicalize(payload ?? {}));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Canonical JSON serialization — key order normalized at every depth, so a
 * payload read back from JSONB (which reorders keys) serializes identically
 * to the in-memory original. Used anywhere a hash must be reproducible
 * across a database round-trip.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(deepCanonicalize(value ?? {}));
}

/**
 * Length-prefix each bound field before joining so a separator byte inside a
 * field cannot shift field boundaries (`approvedBy:'a|b'` must not be able
 * to make the tail of the tuple collide with a different field split).
 */
function canonical(
  auth: Pick<ActionAuthorization, 'approvedBy' | 'approvalRef' | 'grantedAt'>,
  type: string,
  sessionId: string | undefined,
  digest: string,
): string {
  const fields = [auth.approvedBy, auth.approvalRef, auth.grantedAt, type, sessionId ?? '', digest];
  return fields.map((f) => `${String(f ?? '').length}:${String(f ?? '')}`).join('|');
}

/**
 * Mint a signature for an authorization. Returns null when no signing key is
 * configured -- callers must treat null as "cannot issue a verifiable
 * authorization", never as "issue an unsigned one".
 */
export function signAuthorization(
  auth: Pick<ActionAuthorization, 'approvedBy' | 'approvalRef' | 'grantedAt'>,
  type: string,
  sessionId: string | undefined,
  digest: string,
): string | null {
  const key = approvalKey();
  if (!key) return null;
  return createHmac('sha256', key).update(canonical(auth, type, sessionId, digest)).digest('hex');
}

/**
 * Verify an authorization's signature is bound to THIS action type, THIS
 * session, and THIS payload digest. A forged, altered, or replayed record
 * fails because it lacks a signature or carries one computed over different
 * bound fields.
 */
export function verifyAuthorizationSignature(
  auth: ActionAuthorization,
  type: string,
  sessionId: string | undefined,
  digest: string,
): boolean {
  const key = approvalKey();
  if (!key) return false;
  const sig = auth.signature;
  if (typeof sig !== 'string' || sig.length === 0) return false;
  const expected = createHmac('sha256', key).update(canonical(auth, type, sessionId, digest)).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
