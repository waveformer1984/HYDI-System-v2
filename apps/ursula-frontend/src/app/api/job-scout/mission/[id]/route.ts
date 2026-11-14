import { NextRequest, NextResponse } from 'next/server';
import { refuseUnlessUrsulaOperator } from '@/lib/ursula-operator-guard';

export const dynamic = 'force-dynamic';

/** Poll heidi-core mission status after "Run scan now". */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = refuseUnlessUrsulaOperator(req);
  if (denied) return denied;
  const { id } = await params;
  const endpoint = (process.env.HEIDI_CORE_URL || 'http://localhost:3459').replace(/\/$/, '');
  try {
    const res = await fetch(`${endpoint}/missions/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return NextResponse.json({ ok: false, error: (json.error as string) || `heidi-core ${res.status}` }, { status: res.status });
    const mission = (json.mission || json) as Record<string, unknown>;
    const status = typeof mission.status === 'string' ? mission.status : 'unknown';
    const evidence = mission.evidence && typeof mission.evidence === 'object' ? mission.evidence as Record<string, unknown> : {};
    return NextResponse.json({
      ok: true,
      status,
      summary: mission.goal || mission.summary,
      reason: typeof evidence.error === 'string' ? evidence.error : null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: `heidi-core unreachable: ${e instanceof Error ? e.message : e}` }, { status: 503 });
  }
}
