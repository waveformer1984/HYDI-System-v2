import { NextResponse } from 'next/server';
import { gamesStore } from '@/lib/games/store';

gamesStore.init();

export async function GET(): Promise<NextResponse> {
  const sessions = Array.from(gamesStore.sessions.values());
  return NextResponse.json({ success: true, sessions });
}
