import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  findExecutionByIdempotencyKey,
  saveExecutionRecord,
  type UrsulaExecutionRecord,
} from '@/lib/bridge-state-store'
import { withKeyLock } from '@/lib/idempotency-lock'
import { getRequiredUserIdSecure } from '@/lib/request-auth'
import { ResonateModule } from '@/lib/resonate/engine'

function getTraceId(request: NextRequest): string {
  return request.headers.get('x-trace-id') || request.headers.get('x-request-id') || randomUUID()
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown execution error'
}

// POST /api/execute - Canonical Ursula execution endpoint for Heidi bridge
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = getTraceId(request)
  try {
    if (process.env.HYDI_EXECUTION_KILL_SWITCH === 'true') {
      return NextResponse.json(
        { success: false, error: 'Execution blocked by kill switch', traceId, executionState: 'FAILED' },
        { status: 503, headers: { 'x-trace-id': traceId } }
      )
    }

    const authResult = await getRequiredUserIdSecure(request, traceId)
    if (!authResult.ok) return authResult.response
    const { userId, authMethod } = authResult
    if (authMethod === 'header') {
      console.warn(`[AUTH] header-only identity used userId=${userId} traceId=${traceId} — migrate caller to Bearer token`)
    }

    const body = await request.json()
    const idempotencyKey =
      typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
    if (!idempotencyKey) {
      return NextResponse.json(
        { success: false, error: 'idempotencyKey is required', traceId },
        { status: 400, headers: { 'x-trace-id': traceId } }
      )
    }

    const execution = await withKeyLock(`${userId}:${idempotencyKey}`, async () => {
      const existing = await findExecutionByIdempotencyKey(userId, idempotencyKey)
      if (existing) return existing

      const params = body?.params && typeof body.params === 'object' ? body.params : {}
      const executionType = typeof body?.type === 'string' ? body.type : 'resonate'
      const executionId = `ursula-exec-${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const ledgerEntryId = `ledger-${randomUUID().replace(/-/g, '').slice(0, 10)}`
      const now = new Date().toISOString()

      let result: Record<string, unknown> = { summary: 'Execution completed by Ursula canonical endpoint', input_echo: params }
      let tracks: unknown[] | undefined

      if (executionType === 'resonate') {
        const resonateResult = await ResonateModule.execute(params as { bpm?: number; style?: 'electronic' | 'ambient' | 'techno' | 'lofi'; length?: number })
        result = { ...result, resonateId: resonateResult.id, style: resonateResult.style, bpm: resonateResult.bpm, length: resonateResult.length }
        tracks = resonateResult.tracks as unknown[]
      }

      const createdExecution: UrsulaExecutionRecord = {
        id: executionId,
        user_id: userId,
        idempotency_key: idempotencyKey,
        type: executionType,
        status: 'COMPLETED',
        cost: Number(process.env.HYDI_EXECUTION_COST || 2),
        ledger_entry_id: ledgerEntryId,
        result,
        started_at: now,
        completed_at: now,
        trace_id: traceId,
      }

      await saveExecutionRecord(createdExecution)
      return { ...createdExecution, tracks }
    })

    return NextResponse.json(
      {
        success: execution.status === 'COMPLETED',
        executionId: execution.id,
        cost: execution.cost,
        ledgerEntryId: execution.ledger_entry_id,
        executionState: execution.status,
        result: execution.result,
        tracks: (execution as unknown as { tracks?: unknown[] }).tracks,
        error: execution.error,
        traceId: execution.trace_id,
      },
      { headers: { 'x-trace-id': execution.trace_id } }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeError(error), executionState: 'FAILED', traceId },
      { status: 500, headers: { 'x-trace-id': traceId } }
    )
  }
}
