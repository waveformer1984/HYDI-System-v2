import { NextRequest, NextResponse } from 'next/server';
import { setDecision, isValidLeadId, DECISIONS, type Decision } from '@/lib/job-scout-store';
import { refuseUnlessUrsulaOperator } from '@/lib/ursula-operator-guard';

export const dynamic = 'force-dynamic';

/**
 * Record Jordan's decision on a lead (shortlisted | dismissed | applied |
 * clear). Writes decisions.json only; never contacts the job site.
 *
 * CSRF guard: requires the x-ursula-request header (a cross-site form or
 * <img> can't set it) and, when the browser sends Origin, it must match Host.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = refuseUnlessUrsulaOperator(req);
  if (denied) return denied;
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  if (!isValidLeadId(id)) return NextResponse.json({ ok: false, error: 'invalid lead id' }, { status: 400 });

  let body: { status?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const status = body && body.status;
  if (typeof status !== 'string' || (status !== 'clear' && !(DECISIONS as readonly string[]).includes(status))) {
    return NextResponse.json({ ok: false, error: `status must be one of ${DECISIONS.join(', ')} or clear` }, { status: 400 });
  }

  try {
    const decision = setDecision(id, status as Decision | 'clear');
    return NextResponse.json({ ok: true, id, decision });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'write failed' }, { status: 500 });
  }
}
