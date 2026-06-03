import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getPaymentIntentRecordById } from '@/lib/bridge-state-store';
import { getRequiredUserId, isOwnedByUser } from '@/lib/request-auth';

// GET /api/billing/[payment_intent_id] - Get payment status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ payment_intent_id: string }> }
): Promise<NextResponse> {
  const initialTraceId =
    request.headers.get('x-trace-id') || request.headers.get('x-request-id') || randomUUID();
  try {
    const auth = getRequiredUserId(request, initialTraceId);
    if (!auth.ok) return auth.response;
    const { traceId } = auth;

    const { payment_intent_id: paymentIntentId } = await params;
    console.log(`[BILLING] Fetching payment ${paymentIntentId}`);

    const payment = await getPaymentIntentRecordById(paymentIntentId);

    if (!payment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payment not found',
          traceId,
        },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }

    if (!isOwnedByUser(auth.userId, payment.user_id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payment not found',
          traceId,
        },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }

    return NextResponse.json(
      {
        success: true,
        payment,
        timestamp: new Date().toISOString(),
        traceId,
      },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    const traceId = initialTraceId;
    console.error(`[BILLING] Failed to fetch payment:`, error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch payment',
        details: error instanceof Error ? error.message : 'Unknown error',
        traceId,
      },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}
