import { NextResponse } from 'next/server';
import { readScout } from '@/lib/job-scout-store';

export const dynamic = 'force-dynamic';

/** Ranked leads from Heidi's job scout, merged with Jordan's decisions. */
export async function GET() {
  try {
    const { status, leads } = readScout();
    return NextResponse.json({ ok: true, status, leads });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'job scout unreadable' }, { status: 500 });
  }
}
