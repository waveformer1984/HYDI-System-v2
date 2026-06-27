import { NextRequest, NextResponse } from 'next/server';
import { UrsulaBridge } from '@/lib/ursula-bridge';
import { AtomicGovernance } from '@/lib/atomic-governance';
import { toStorageTaskStatus } from '@/lib/task-status';
import { getHydiTaskById, upsertHydiTask } from '@/lib/hydi-task-store';
import type { TaskState } from '@/lib/governance';
import {
  buildTraceHeaders,
  getTraceId,
  isExecutionKillSwitchEnabled,
} from '@/lib/phase1-gates';
import { getRequiredUserIdSecure } from '@/lib/request-auth';

// POST /api/hydi/tasks/:id/execute - Execute task through Ursula ONLY
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const traceId = getTraceId(request);
  try {
    if (isExecutionKillSwitchEnabled()) {
      return NextResponse.json(
        {
          error: 'Execution blocked by kill switch',
          traceId,
        },
        { status: 503, headers: buildTraceHeaders(traceId) }
      );
    }

    const { id } = await params;
    const authResult = await getRequiredUserIdSecure(request, traceId);
    if (!authResult.ok) return authResult.response;
    const { userId, authMethod } = authResult;
    if (authMethod === 'header') {
      console.warn(`[AUTH] header-only identity used userId=${userId} traceId=${traceId} — migrate caller to Bearer token`);
    }

    const getCurrentTask = async (task_id: string) => {
      return await getHydiTaskById(task_id);
    };

    const writeTask = async (updatedTask: any) => {
      await upsertHydiTask(updatedTask);
    };

    const currentTask = await getCurrentTask(id);
    if (!currentTask) {
      return NextResponse.json(
        { error: 'Task not found', traceId },
        { status: 404, headers: buildTraceHeaders(traceId) }
      );
    }

    // STEP 2: Check if user can afford execution (Ursula decides)
    const creditCheck = await UrsulaBridge.checkUserCredits(userId, traceId);
    if (!creditCheck.canExecute) {
      return NextResponse.json(
        {
          error: 'Insufficient credits or inactive subscription',
          creditsRemaining: creditCheck.creditsRemaining,
          subscriptionActive: creditCheck.subscriptionActive,
          traceId,
        },
        { status: 402, headers: buildTraceHeaders(traceId) }
      );
    }

    // STEP 3: Create payment intent through Ursula
    const paymentIntent = await UrsulaBridge.createPaymentIntent(userId, 2, traceId);
    if (!paymentIntent.success) {
      return NextResponse.json(
        {
          error: 'Failed to create payment intent',
          details: paymentIntent.error,
          traceId,
        },
        { status: 500, headers: buildTraceHeaders(traceId) }
      );
    }

    // STEP 4: Update task with billing info (atomic governance)
    const billingUpdate = await AtomicGovernance.commitTaskUpdate(
      getCurrentTask,
      writeTask,
      {
        task_id: id,
        status: toStorageTaskStatus('running') as TaskState,
        ursula_payment_intent_id: paymentIntent.paymentIntentId,
        billing_status: 'pending',
        updated_at: new Date().toISOString(),
      }
    );

    if (!billingUpdate.success) {
      return NextResponse.json(
        {
          error: 'Failed to update task for execution',
          violations: billingUpdate.violations,
          traceId,
        },
        { status: billingUpdate.http_status || 400, headers: buildTraceHeaders(traceId) }
      );
    }

    // STEP 5: Execute through Ursula (ONLY execution path)
    const executionResult = await UrsulaBridge.executeTask(
      userId,
      'resonate', // All HYDI tasks go through Resonate
      currentTask.inputs,
      id,
      traceId
    );

    // STEP 6: Update task with execution results (atomic governance)
    const executionUpdate = await AtomicGovernance.commitTaskUpdate(
      getCurrentTask,
      writeTask,
      {
        task_id: id,
        status: (executionResult.success ? toStorageTaskStatus('completed') : toStorageTaskStatus('failed_retryable')) as TaskState,
        ursula_execution_id: executionResult.executionId,
        ursula_ledger_entry_id: executionResult.ledgerEntryId,
        ursula_execution_state: executionResult.executionState,
        ursula_cost: executionResult.cost,
        billing_status: executionResult.success ? 'paid' : 'failed',
        result: executionResult.result,
        error: executionResult.error,
        updated_at: new Date().toISOString(),
      }
    );

    if (!executionUpdate.success) {
      console.error('[EXECUTE] Failed to update task with execution results:', executionUpdate.violations);
      // Don't fail the request - execution succeeded but tracking failed
    }

    console.log(`[EXECUTE] Task ${id} executed through Ursula:`, {
      executionId: executionResult.executionId,
      cost: executionResult.cost,
      success: executionResult.success,
    });

    return NextResponse.json(
      {
        success: executionResult.success,
        task: executionUpdate.task || billingUpdate.task,
        execution: {
          executionId: executionResult.executionId,
          cost: executionResult.cost,
          ledgerEntryId: executionResult.ledgerEntryId,
          executionState: executionResult.executionState,
        },
        billing: {
          paymentIntentId: paymentIntent.paymentIntentId,
          status: executionResult.success ? 'paid' : 'failed',
        },
        traceId,
      },
      { headers: buildTraceHeaders(traceId) }
    );

  } catch (error) {
    console.error('[EXECUTE] Task execution error:', error);
    return NextResponse.json(
      {
        error: 'Task execution failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        traceId,
      },
      { status: 500, headers: buildTraceHeaders(traceId) }
    );
  }
}
