import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  createPaymentIntentRecord,
  savePaymentIntentRecord,
} from '@/lib/bridge-state-store';
import { getRequiredUserIdSecure } from '@/lib/request-auth';

function getTraceId(request: NextRequest): string {
  return request.headers.get('x-trace-id') || request.headers.get('x-request-id') || randomUUID();
}

// POST /api/billing/create-intent - Canonical bridge payment intent endpoint
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = getTraceId(request);
  try {
    const authResult = await getRequiredUserIdSecure(request, traceId);
    if (!authResult.ok) return authResult.response;
    const { userId, authMethod } = authResult;
    if (authMethod === 'header') {
      console.warn(`[AUTH] header-only identity used userId=${userId} traceId=${traceId} — migrate caller to Bearer token`);
    }

    const body = await request.json().catch(() => ({}));
    const amount = Number(body?.amount);
    const normalizedAmount = Number.isFinite(amount) && amount > 0 ? amount : 2;

    const paymentIntent = createPaymentIntentRecord({
      userId,
      amount: normalizedAmount,
      traceId,
    });
    await savePaymentIntentRecord(paymentIntent);

    return NextResponse.json(
      {
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        traceId,
      },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create payment intent',
        traceId,
      },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}
