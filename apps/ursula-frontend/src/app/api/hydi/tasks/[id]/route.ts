import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { UDPTaskCore } from '@/types/task';
import { AtomicGovernance, AtomicUpdateRequest } from '@/lib/atomic-governance';
import { normalizeTaskForApi, normalizeTaskStatus, toStorageTaskStatus } from '@/lib/task-status';
import { getHydiTaskById, upsertHydiTask } from '@/lib/hydi-task-store';
import { getRequiredUserId, getTaskOwnerUserId, isOwnedByUser } from '@/lib/request-auth';

// GET /api/hydi/tasks/:id - Get single task
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

    const { id } = await params;
    const task = await getHydiTaskById(id);

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found', traceId },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }

    const ownerUserId = getTaskOwnerUserId(task);
    if (!isOwnedByUser(auth.userId, ownerUserId)) {
      return NextResponse.json(
        { error: 'Task not found', traceId },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }

    return NextResponse.json(
      { task: normalizeTaskForApi(task), traceId },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    console.error('[TASK] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load task', traceId },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}

// PATCH /api/hydi/tasks/:id - Atomic task update (validate before write)
export async function PATCH(
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

    const { id } = await params;
    const currentTask = await getHydiTaskById(id);
    if (!currentTask) {
      return NextResponse.json(
        { error: 'Task not found', traceId },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }
    const ownerUserId = getTaskOwnerUserId(currentTask);
    if (!isOwnedByUser(auth.userId, ownerUserId)) {
      return NextResponse.json(
        { error: 'Task not found', traceId },
        { status: 404, headers: { 'x-trace-id': traceId } }
      );
    }

    const updates = await request.json();

    const normalizedUpdates = { ...updates };
    if (updates.status) {
      normalizedUpdates.status = toStorageTaskStatus(normalizeTaskStatus(updates.status));
    }

    // ATOMIC COMMIT: Validate before write, reject before commit
    const updateRequest: AtomicUpdateRequest = {
      task_id: id,
      ...normalizedUpdates
    };

    const result = await AtomicGovernance.commitTaskUpdate(
      // getCurrentTask function
      async (task_id: string) => {
        return await getHydiTaskById(task_id);
      },
      // writeTask function
      async (updatedTask: any) => {
        await upsertHydiTask(updatedTask as UDPTaskCore);
      },
      updateRequest
    );

    if (!result.success) {
      console.error('[ATOMIC-GOVERNANCE] Update rejected:', result.violations);
      return NextResponse.json({
        error: result.error,
        violations: result.violations,
        traceId,
      }, { status: result.http_status || 400, headers: { 'x-trace-id': traceId } });
    }

    console.log(`[ATOMIC-GOVERNANCE] Task ${id} updated successfully`);

    return NextResponse.json(
      {
        task: result.task ? normalizeTaskForApi(result.task) : result.task,
        traceId,
      },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    console.error('[ATOMIC-GOVERNANCE] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update task', traceId },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}
