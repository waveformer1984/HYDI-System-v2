import { NextRequest, NextResponse } from 'next/server';
import { refuseUnlessUrsulaOperator } from '@/lib/ursula-operator-guard';
import { postDeviceAction } from '@/lib/hydi-devices-proxy';

export const dynamic = 'force-dynamic';

/** Approve (operator role) or reject (revoke) a pending heidi-mobile device. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const denied = refuseUnlessUrsulaOperator(req);
  if (denied) return denied;
  const { deviceId: raw } = await params;
  const deviceId = decodeURIComponent(raw);
  if (!deviceId || deviceId.length > 128) {
    return NextResponse.json({ ok: false, error: 'invalid device_id' }, { status: 400 });
  }
  let body: { action?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action;
  if (action === 'approve') {
    const result = await postDeviceAction(deviceId, 'approve', { role: 'operator' });
    if (!result.ok) return NextResponse.json(result, { status: result.status && result.status >= 400 ? result.status : 502 });
    return NextResponse.json({ ok: true, device: result.device });
  }
  if (action === 'reject') {
    const result = await postDeviceAction(deviceId, 'revoke', { reason: 'rejected from Ursula' });
    if (!result.ok) return NextResponse.json(result, { status: result.status && result.status >= 400 ? result.status : 502 });
    return NextResponse.json({ ok: true, device: result.device });
  }
  return NextResponse.json({ ok: false, error: "action must be 'approve' or 'reject'" }, { status: 400 });
}
