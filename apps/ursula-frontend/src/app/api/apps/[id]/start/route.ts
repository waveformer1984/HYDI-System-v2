import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

/**
 * "Start" files a heidi-core restart-module mission through the existing
 * mission surface — Ursula never spawns processes itself.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = JSON.stringify({ type: 'restart-module', moduleId: id, requestedBy: 'ursula-workspace' });
    const endpoint = process.env.HEIDI_CORE_URL || 'http://localhost:3459';
    const res = await fetch(`${endpoint}/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(4000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ ok: false, error: json.error || `heidi-core ${res.status}` }, { status: res.status });
    return NextResponse.json({ ok: true, ...json });
  } catch (e: any) {
    // Heidi-core unreachable or refused — reported, never bypassed.
    return NextResponse.json({ ok: false, error: `mission surface unreachable: ${e?.message || e}` }, { status: 503 });
  }
}
