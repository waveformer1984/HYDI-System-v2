import { NextRequest, NextResponse } from 'next/server';
import { refuseUnlessUrsulaOperator } from '@/lib/ursula-operator-guard';
import { listDevices } from '@/lib/hydi-devices-proxy';

export const dynamic = 'force-dynamic';

/** Pending heidi-mobile devices (proxied from heidi-web /api/devices). */
export async function GET(req: NextRequest) {
  const denied = refuseUnlessUrsulaOperator(req, { requireCsrf: false });
  if (denied) return denied;
  const result = await listDevices();
  if (!result.ok) return NextResponse.json(result, { status: result.status && result.status >= 400 ? result.status : 503 });
  return NextResponse.json({ ok: true, pending: result.pending });
}
