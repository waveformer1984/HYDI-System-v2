import { NextResponse } from 'next/server';
import { getRevenueEngineStatus, hydiAutopilot } from '@/lib/revenue-engine/engine';

export async function GET(): Promise<NextResponse> {
  try {
    const status = await getRevenueEngineStatus();
    return NextResponse.json({ status });
  } catch (error) {
    console.error('[REVENUE_ENGINE][AUTOPILOT] Failed to fetch status:', error);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const summary = await hydiAutopilot();
    const status = await getRevenueEngineStatus();
    return NextResponse.json({
      success: true,
      summary,
      status,
      ran_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[REVENUE_ENGINE][AUTOPILOT] Failed to run autopilot:', error);
    return NextResponse.json({ error: 'Failed to run autopilot' }, { status: 500 });
  }
}
