import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getExecutionRecordById } from '@/lib/bridge-state-store';
import { getRequiredUserId, getTaskOwnerUserId, isOwnedByUser } from '@/lib/request-auth';

// GET /api/executions/[id] - Get specific execution status from Ursula
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const auth = getRequiredUserId(request, traceId);
    if (!auth.ok) return auth.response;

    const { id: executionId } = await params;
    console.log(`[EXECUTIONS] Fetching execution ${executionId}`);

    const execution = await getExecutionRecordById(executionId);

    if (!execution) {
      return NextResponse.json({
        success: false,
        error: 'Execution not found',
        traceId,
      }, { status: 404, headers: { 'x-trace-id': traceId } });
    }

    const ownerUserId = getTaskOwnerUserId(execution);
    if (!isOwnedByUser(auth.userId, ownerUserId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Execution not found',
          traceId,
        },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }

    return NextResponse.json({
      success: true,
      execution,
      timestamp: new Date().toISOString(),
      traceId,
    }, { headers: { 'x-trace-id': traceId } });

  } catch (error) {
    console.error(`[EXECUTIONS] Failed to fetch execution:`, error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch execution',
      details: error instanceof Error ? error.message : 'Unknown error',
      traceId,
    }, { status: 500, headers: { 'x-trace-id': traceId } });
  }
}
