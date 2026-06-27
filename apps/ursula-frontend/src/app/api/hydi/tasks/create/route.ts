import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { UDPTaskCore } from '@/types/task';
import { TaskGovernance } from '@/lib/governance';
import { normalizeTaskForApi, normalizeTaskStatus, toStorageTaskStatus } from '@/lib/task-status';
import { appendHydiTask } from '@/lib/hydi-task-store';
import { getRequiredUserId } from '@/lib/request-auth';

// POST /api/hydi/tasks/create - Create new task with governance validation
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const taskData = await request.json();
    const auth = getRequiredUserId(request, traceId);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    // Create task with required fields
    const newTask: UDPTaskCore = {
      task_id: randomUUID(),
      source: 'manual',
      system: taskData.system || 'general',
      type: taskData.type || 'build',
      title: taskData.title,
      description: taskData.description || '',
      inputs: taskData.inputs || {},
      outputs_expected: taskData.outputs_expected || {},
      dependencies: taskData.dependencies || [],
      priority: taskData.priority || 5,
      urgency: taskData.urgency || 5,
      revenue_impact: {
        stage: 'blocked',
        value: taskData.revenue_impact?.value || 0,
      },
      status: toStorageTaskStatus(normalizeTaskStatus(taskData.status || 'planned')),
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state_version: 1, // Required for atomic governance

      // URSULA INTEGRATION FIELDS (empty initially)
      ursula_execution_id: undefined,
      ursula_ledger_entry_id: undefined,
      ursula_payment_intent_id: undefined,
      ursula_execution_state: undefined,
      ursula_cost: undefined,
      billing_status: undefined,
      owner_user_id: userId,
    };

    // Validate task creation with governance
    const validation = TaskGovernance.validateTaskCreation(newTask);
    if (!validation.valid) {
      return NextResponse.json({
        error: 'Task validation failed',
        details: validation.error,
        traceId,
      }, { status: 400, headers: { 'x-trace-id': traceId } });
    }

    // Save task
    await appendHydiTask(newTask);

    console.log(`[TASKS] Created task ${newTask.task_id} for user ${userId}`);

    return NextResponse.json(
      {
        success: true,
        task: normalizeTaskForApi(newTask),
        traceId,
      },
      { headers: { 'x-trace-id': traceId } }
    );

  } catch (error) {
    console.error('[TASKS] Create task error:', error);
    return NextResponse.json({
      error: 'Failed to create task',
      details: error instanceof Error ? error.message : 'Unknown error',
      traceId,
    }, { status: 500, headers: { 'x-trace-id': traceId } });
  }
}
