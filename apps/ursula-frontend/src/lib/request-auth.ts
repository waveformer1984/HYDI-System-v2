/**
 * request-auth.ts — Identity extraction and auth utilities for Ursula API routes.
 *
 * Auth priority:
 *   1. Authorization: Bearer <JWT>  (cryptographically verified — preferred)
 *   2. x-user-id header             (not tamper-proof — backward-compat only)
 *
 * Migration path: callers should move to getRequiredUserIdSecure() which
 * returns authMethod so you can log/alert on header-only auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildTraceHeaders, getTraceId } from '@/lib/phase1-gates';

// ── JWT verification ────────────────────────────────────────────────────────

function getJwtSecret(): string | null {
  const s = process.env.JWT_SECRET;
  return s && s.length >= 32 ? s : null;
}

async function verifyBearerToken(authHeader: string): Promise<string | null> {
  const secret = getJwtSecret();
  if (!secret) return null;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    // jsonwebtoken is available per package.json; dynamically required so this
    // module loads in environments where it may not be installed yet.
    const jwt = require('jsonwebtoken') as any;
    const payload = jwt.verify(token, secret) as Record<string, unknown>;
    const userId =
      (payload.sub as string | undefined) ||
      (payload['userId'] as string | undefined) ||
      (payload['user_id'] as string | undefined);
    return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  } catch {
    return null;
  }
}

// ── Secure async variants (preferred) ──────────────────────────────────────

export async function getRequestUserIdSecure(
  request: NextRequest
): Promise<{ userId: string; method: 'jwt' | 'header' } | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const userId = await verifyBearerToken(authHeader);
    if (userId) return { userId, method: 'jwt' };
  }
  const value = request.headers.get('x-user-id')?.trim();
  if (value) return { userId: value, method: 'header' };
  return null;
}

export async function getRequiredUserIdSecure(
  request: NextRequest,
  providedTraceId?: string
): Promise<
  | { ok: true; userId: string; traceId: string; authMethod: 'jwt' | 'header' }
  | { ok: false; traceId: string; response: NextResponse }
> {
  const traceId = providedTraceId || getTraceId(request);
  const result = await getRequestUserIdSecure(request);
  if (result) {
    return { ok: true, userId: result.userId, traceId, authMethod: result.method };
  }
  return {
    ok: false,
    traceId,
    response: NextResponse.json(
      {
        error: 'Authentication required. Provide Authorization: Bearer <token> or x-user-id header.',
        traceId,
      },
      { status: 401, headers: buildTraceHeaders(traceId) }
    ),
  };
}

// ── Legacy synchronous variants (backward-compat, header-only) ─────────────

/** @deprecated Use getRequestUserIdSecure() — this reads x-user-id without JWT verification. */
export function getRequestUserId(request: NextRequest): string | undefined {
  const value = request.headers.get('x-user-id');
  const userId = typeof value === 'string' ? value.trim() : '';
  return userId || undefined;
}

export function getTaskOwnerUserId(task: unknown): string | undefined {
  if (!task || typeof task !== 'object') return undefined;
  const maybeOwner = (task as Record<string, unknown>).owner_user_id;
  if (typeof maybeOwner === 'string' && maybeOwner.trim()) return maybeOwner.trim();
  const maybeLegacyOwner = (task as Record<string, unknown>).user_id;
  if (typeof maybeLegacyOwner === 'string' && maybeLegacyOwner.trim()) {
    return maybeLegacyOwner.trim();
  }
  return undefined;
}

export function isOwnedByUser(actorUserId: string, resourceOwnerUserId?: string): boolean {
  if (!resourceOwnerUserId) return false;
  return actorUserId === resourceOwnerUserId;
}

/** @deprecated Use getRequiredUserIdSecure() — async, JWT-first. */
export function getRequiredUserId(
  request: NextRequest,
  providedTraceId?: string
):
  | { ok: true; userId: string; traceId: string }
  | { ok: false; traceId: string; response: NextResponse } {
  const traceId = providedTraceId || getTraceId(request);
  const userId = getRequestUserId(request);
  if (!userId) {
    return {
      ok: false,
      traceId,
      response: NextResponse.json(
        { error: 'Missing x-user-id header', traceId },
        { status: 401, headers: buildTraceHeaders(traceId) }
      ),
    };
  }
  return { ok: true, userId, traceId };
}

export const requireUserId = getRequiredUserId;
