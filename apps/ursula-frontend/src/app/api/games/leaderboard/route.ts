import { NextResponse } from 'next/server';
import { gamesStore } from '@/lib/games/store';

gamesStore.init();

export async function GET(): Promise<NextResponse> {
  const leaderboard = gamesStore.getLeaderboard();
  return NextResponse.json({ success: true, leaderboard });
}
