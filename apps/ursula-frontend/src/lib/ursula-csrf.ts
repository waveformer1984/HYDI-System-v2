import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isLocalRequest } from '@/lib/heidi-relay';

/** Loopback + optional CSRF header + same-origin (for mutating routes). */
export function refuseUnlessUrsulaLocal(req: NextRequest, { requireCsrf = true } = {}): NextResponse | null {
  if (!isLocalRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: 'local_only' }, { status: 403 });
  }
  if (requireCsrf && req.method !== 'GET' && req.headers.get('x-ursula-request') !== '1') {
    return NextResponse.json({ ok: false, error: 'missing x-ursula-request header' }, { status: 403 });
  }
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ ok: false, error: 'cross-origin request refused' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ ok: false, error: 'bad origin' }, { status: 403 });
    }
  }
  return null;
}
