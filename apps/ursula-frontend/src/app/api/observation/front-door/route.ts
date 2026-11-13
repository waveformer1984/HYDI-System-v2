import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { refuseUnlessUrsulaLocal } from '@/lib/ursula-csrf';

export const dynamic = 'force-dynamic';

/** Latest Frank front-door probe (.runtime/observation/front-door.json). */
export async function GET(req: NextRequest) {
  const denied = refuseUnlessUrsulaLocal(req, { requireCsrf: false });
  if (denied) return denied;
  const root = process.env.HYDI_REPO_ROOT || path.resolve(process.cwd(), '..', '..');
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.runtime', 'observation', 'front-door.json'), 'utf8'));
    return NextResponse.json({ ok: true, frontDoor: raw });
  } catch {
    return NextResponse.json({ ok: true, frontDoor: null });
  }
}
