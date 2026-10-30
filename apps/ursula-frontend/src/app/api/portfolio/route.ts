import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function portfolioPath(): string {
  const local = path.resolve(process.cwd(), 'config', 'portfolio.json');
  return fs.existsSync(local)
    ? local
    : path.resolve(process.cwd(), '..', '..', 'config', 'portfolio.json');
}

export async function GET() {
  try {
    const raw = JSON.parse(fs.readFileSync(portfolioPath(), 'utf8'));
    return NextResponse.json({ ok: true, apps: raw.apps || [], suiteBase: raw.suiteDefaults?.suiteBase || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'portfolio unreadable' }, { status: 500 });
  }
}
