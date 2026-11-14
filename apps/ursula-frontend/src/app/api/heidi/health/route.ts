import { coreUrl, coreHeaders } from '@/lib/heidi-relay';
import { refuseUnlessUrsulaOperator } from '@/lib/ursula-operator-guard';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** Is heidi-core answering? Drives the panel's status dot. */
export async function GET(req: NextRequest): Promise<Response> {
  const denied = refuseUnlessUrsulaOperator(req, { requireCsrf: false });
  if (denied) return denied;
  try {
    const r = await fetch(coreUrl('/health'), { headers: coreHeaders(), signal: AbortSignal.timeout(3000) });
    return Response.json({ ok: r.ok, status: r.status });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
