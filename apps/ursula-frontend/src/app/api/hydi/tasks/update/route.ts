import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { VersionedGovernance, VersionedUpdateRequest } from '@/lib/versioned-governance';
import { normalizeTaskForApi, normalizeTaskStatus, toStorageTaskStatus } from '@/lib/task-status';
import { getHydiTaskById, updateHydiTaskById } from '@/lib/hydi-task-store';

// POST /api/hydi/tasks/update - Versioned task update with optimistic locking
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const { task_id, status, result: requestResult, error, expected_version, ...otherUpdates } = await request.json();
    const normalizedStatus = status ? toStorageTaskStatus(normalizeTaskStatus(status)) : undefined;

    if (!task_id) {
      return NextResponse.json(
        { error: 'Task ID required', traceId },
        { status: 400, headers: { 'x-trace-id': traceId } }
      );
    }

    // STRICT: Version is required for ALL updates
    if (expected_version === undefined) {
      return NextResponse.json({
        error: 'expected_version is required for all task updates',
        code: 'VERSION_REQUIRED',
        traceId,
      }, { status: 400, headers: { 'x-trace-id': traceId } });
    }

    // VERSIONED COMMIT: Validate + version check + atomic write
    const updateRequest: VersionedUpdateRequest = {
      task_id,
      status: normalizedStatus,
      result: requestResult,
      error,
      expected_version,
      ...otherUpdates
    };

    const result = await VersionedGovernance.commitWithOptimisticLocking(
      // getCurrentTask function
      async (id: string) => {
        const currentTask = await getHydiTaskById(id);
        if (!currentTask) return null;
        if (currentTask.state_version === undefined) {
          return { ...currentTask, state_version: 1 };
        }
        return currentTask;
      },
      // writeTaskWithVersion function (optimistic locking)
      async (updatedTask: any) => {
        const currentTask = await getHydiTaskById(updatedTask.task_id);
        if (!currentTask) {
          return false;
        }
        const currentVersion = currentTask.state_version || 0;

        // Verify version hasn't changed
        if (currentVersion !== updatedTask.state_version - 1) {
          return false; // Version conflict
        }

        await updateHydiTaskById(updatedTask.task_id, updatedTask);
        return true;
      },
      updateRequest
    );

    if (!result.success) {
      console.error('[VERSIONED-GOVERNANCE] Update rejected:', result.violations || result.error);

      // Return specific error information
      const response: any = {
        error: result.error,
        timestamp: new Date().toISOString(),
        traceId,
      };

      if (result.violations) {
        response.violations = result.violations;
      }

      if (result.current_version !== undefined) {
        response.current_version = result.current_version;
      }

      if (result.conflict_detected) {
        response.conflict_detected = true;
      }

      return NextResponse.json(response, {
        status: result.http_status || 400,
        headers: { 'x-trace-id': traceId },
      });
    }

    console.log(`[VERSIONED-GOVERNANCE] Task ${task_id} updated to version ${result.current_version}`);

    return NextResponse.json({
      success: true,
      task: result.task ? normalizeTaskForApi(result.task) : result.task,
      current_version: result.current_version,
      timestamp: new Date().toISOString(),
      traceId,
    }, { headers: { 'x-trace-id': traceId } });

  } catch (error) {
    console.error('[VERSIONED-GOVERNANCE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update task', traceId },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}
