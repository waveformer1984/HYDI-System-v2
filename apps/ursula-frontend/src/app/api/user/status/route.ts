import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { LedgerService } from '@/lib/ledger-service';
import { getRequiredUserIdSecure } from '@/lib/request-auth';

const ledgerService = new LedgerService();

function getTraceId(request: NextRequest): string {
  return request.headers.get('x-trace-id') || request.headers.get('x-request-id') || randomUUID();
}

// GET /api/user/status - Canonical credit + subscription status endpoint for UrsulaBridge
export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = getTraceId(request);
  try {
    const authResult = await getRequiredUserIdSecure(request, traceId);
    if (!authResult.ok) return authResult.response;
    const { userId, authMethod } = authResult;
    if (authMethod === 'header') {
      console.warn(`[AUTH] header-only identity used userId=${userId} traceId=${traceId} — migrate caller to Bearer token`);
    }

    const creditsRemaining = await ledgerService.getBalance(userId);
    const subscriptionActive = process.env.HYDI_REQUIRE_SUBSCRIPTION === 'true'
      ? creditsRemaining > 0
      : true;

    return NextResponse.json(
      {
        userId,
        creditsRemaining,
        subscriptionActive,
        traceId,
      },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch user status',
        traceId,
      },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}
