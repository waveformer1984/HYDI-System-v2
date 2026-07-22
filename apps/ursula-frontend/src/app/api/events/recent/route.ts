import { NextRequest, NextResponse } from 'next/server';
import { getEventRecorder } from '@repo/lib/event-bus';
import type { EventRecorder } from '@repo/lib/event-bus/recorder';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '100', 10);
    const recorder = getEventRecorder() as EventRecorder | null;

    if (!recorder) {
      return NextResponse.json({ events: [] });
    }

    const events = recorder.getRecent(Math.min(limit, 1000));
    return NextResponse.json({ events });
  } catch (error) {
    console.error('[EventsRecent] Failed to fetch recent events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}
