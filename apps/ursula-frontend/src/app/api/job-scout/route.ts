import { NextResponse } from 'next/server';
import { readScout } from '@/lib/job-scout-store';

export const dynamic = 'force-dynamic';

/** Ranked leads from Heidi's job scout, merged with Jordan's decisions. */
export async function GET() {
  try {
    const { status, leads } = readScout();
    // Mirrors scripts/hydi-schedulers.js heidi-job-scout interval so the UI
    // can flag a stale scan (> 2x interval) without hardcoding it twice.
    const scanIntervalMs = Number(process.env.JOB_SCOUT_INTERVAL_MS) || 10800000;
    return NextResponse.json({ ok: true, status, leads, scanIntervalMs });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'job scout unreadable' }, { status: 500 });
  }
}
