import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const OPERATOR_COOKIE = 'ursula_operator_session';

function expectedCookieValue(secret: string): string {
  return `v1.${createHmac('sha256', secret).update('ursula-operator-browser').digest('hex')}`;
}

/** Timing-safe Bearer check against URSULA_ADMIN_TOKEN (server env only). */
export function bearerMatches(headers: Headers, secret: string): boolean {
  const auth = headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function cookieMatches(cookieHeader: string | null | undefined, secret: string): boolean {
  if (!cookieHeader) return false;
  const expected = expectedCookieValue(secret);
  const found = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${OPERATOR_COOKIE}=`));
  if (!found) return false;
  const val = decodeURIComponent(found.slice(OPERATOR_COOKIE.length + 1));
  const a = Buffer.from(val);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isOperatorAuthorized(headers: Headers): boolean {
  const secret = process.env.URSULA_ADMIN_TOKEN;
  if (!secret) return false;
  return bearerMatches(headers, secret) || cookieMatches(headers.get('cookie'), secret);
}

/** 503 when unset; 401 when Bearer/cookie invalid. */
export function requireUrsulaAdmin(headers: Headers): NextResponse | null {
  const secret = process.env.URSULA_ADMIN_TOKEN;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'admin_token_not_configured' }, { status: 503 });
  }
  if (!isOperatorAuthorized(headers)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export function operatorSessionCookieOptions(secret: string): { name: string; value: string; options: Record<string, unknown> } {
  return {
    name: OPERATOR_COOKIE,
    value: expectedCookieValue(secret),
    options: {
      httpOnly: true,
      secure: false,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: 60 * 60 * 12,
    },
  };
}
