import { NextResponse } from 'next/server';
import { ensureDeliveries, listDeliveries, listProducts } from '@/lib/revenue-engine/engine';

export async function GET(): Promise<NextResponse> {
  try {
    const [deliveries, products] = await Promise.all([listDeliveries(), listProducts()]);
    return NextResponse.json({ deliveries, products });
  } catch (error) {
    console.error('[REVENUE_ENGINE][DELIVERIES] Failed to list deliveries:', error);
    return NextResponse.json({ error: 'Failed to list deliveries' }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const result = await ensureDeliveries();
    return NextResponse.json({ success: true, ...result, ran_at: new Date().toISOString() });
  } catch (error) {
    console.error('[REVENUE_ENGINE][DELIVERIES] Failed to process deliveries:', error);
    return NextResponse.json({ error: 'Failed to process deliveries' }, { status: 500 });
  }
}
