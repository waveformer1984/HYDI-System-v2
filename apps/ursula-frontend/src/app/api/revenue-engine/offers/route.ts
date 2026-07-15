import { NextResponse } from 'next/server';
import { listOffers } from '@/lib/revenue-engine/engine';

export async function GET(): Promise<NextResponse> {
  try {
    const offers = await listOffers();
    return NextResponse.json({ offers });
  } catch (error) {
    console.error('[REVENUE_ENGINE][OFFERS] Failed to list offers:', error);
    return NextResponse.json({ error: 'Failed to list offers' }, { status: 500 });
  }
}
