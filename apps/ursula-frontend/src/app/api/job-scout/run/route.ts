import { NextRequest, NextResponse } from 'next/server';
import { fileScanNowMission } from '@/lib/job-scout-mission';
import { refuseUnlessUrsulaOperator } from '@/lib/ursula-operator-guard';

export const dynamic = 'force-dynamic';

/**
 * "Run scan now" — files an informational heidi-core mission. Same CSRF
 * guard as the decision route: x-ursula-request header + same-origin check.
 * Ursula never spawns the scan itself.
 */
export async function POST(req: NextRequest) {
  const denied = refuseUnlessUrsulaOperator(req);
  if (denied) return denied;

  const result = await fileScanNowMission();
  if (!result.ok) return NextResponse.json(result, { status: 503 });
  return NextResponse.json({
    ok: true,
    missionId: result.missionId,
    summary: result.summary,
    mission: result.mission,
  });
}
