import { NextResponse } from 'next/server';
import { blameStore } from '@/lib/blame-games/store';

blameStore.init();

export async function GET(): Promise<NextResponse> {
  const leaderboard = blameStore.getLeaderboard();
  return NextResponse.json({ success: true, leaderboard });
}
