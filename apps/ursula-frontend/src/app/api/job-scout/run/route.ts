import { NextRequest, NextResponse } from 'next/server';
import { fileScanNowMission } from '@/lib/job-scout-mission';

export const dynamic = 'force-dynamic';

/**
 * "Run scan now" — files an informational heidi-core mission. Same CSRF
 * guard as the decision route: x-ursula-request header + same-origin check.
 * Ursula never spawns the scan itself.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('x-ursula-request') !== '1') {
    return NextResponse.json({ ok: false, error: 'missing x-ursula-request header' }, { status: 403 });
  }
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return NextResponse.json({ ok: false, error: 'cross-origin request refused' }, { status: 403 });
    } catch {
      return NextResponse.json({ ok: false, error: 'bad origin' }, { status: 403 });
    }
  }

  const result = await fileScanNowMission();
  if (!result.ok) return NextResponse.json(result, { status: 503 });
  return NextResponse.json(result);
}
