import { NextRequest, NextResponse } from 'next/server';
import { TaskGovernance } from '@/lib/governance';
import { HumanReviewPipeline } from '@/lib/human-review-pipeline';
import { GlobalSafetyValves } from '@/lib/global-safety-valves';
import { learnFromFailure } from '@/lib/heidi-loop-engine';
import { loadHydiTasks, updateHydiTask, type HydiStoredTask } from '@/lib/hydi-task-store';
import { normalizeTaskStatus, type CanonicalTaskStatus } from '@/lib/task-status';
import {
  buildTraceHeaders,
  getTraceId,
  isExecutionKillSwitchEnabled,
} from '@/lib/phase1-gates';
import { getStreamConsumer } from '@/lib/queue/stream-consumer';
import { getHealingService } from '@/lib/healing/claude-healing';

interface ExecuteFilters {
  system?: string;
  source?: string;
  type?: string;
}

function pickNextRunnableTask(tasks: HydiStoredTask[], filters: ExecuteFilters): HydiStoredTask | null {
  const runnable = tasks.filter((task) => {
    const status = normalizeTaskStatus(task.status);
    if (status !== 'queued') return false;
    const taskSystem = typeof task.system === 'string' ? task.system.toLowerCase() : '';
    const taskSource = typeof task.source === 'string' ? task.source.toLowerCase() : '';
    const taskType = typeof task.type === 'string' ? task.type.toLowerCase() : '';
    if (filters.system && taskSystem !== filters.system) return false;
    if (filters.source && taskSource !== filters.source) return false;
    if (filters.type && taskType !== filters.type) return false;
    return true;
  });
  if (runnable.length === 0) return null;
  runnable.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return runnable[0];
}

function inferResultStatus(result: any): CanonicalTaskStatus {
  if (!result) return 'completed';
  if (result.success === false) {
    return result.retryable === false || result.nonRetryable === true
      ? 'failed_terminal'
      : 'failed_retryable';
  }
  return 'completed';
}

async function executeTask(task: HydiStoredTask, traceId: string): Promise<{
  result_status: CanonicalTaskStatus;
  output: any;
  error?: string;
}> {
  const endpoint = process.env.HYDI_EXECUTOR_URL || process.env.URSULA_EXECUTOR_URL;
  if (!endpoint) {
    // Phase 1 no-mock gate: do not silently succeed without a real executor endpoint.
    return {
      result_status: 'failed_retryable',
      output: {},
      error: 'No HYDI_EXECUTOR_URL or URSULA_EXECUTOR_URL configured',
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-trace-id': traceId,
    },
    body: JSON.stringify({
      task_id: task.task_id,
      title: task.title,
      description: task.description,
      type: task.type,
      system: task.system,
      inputs: task.inputs,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      result_status: 'failed_retryable',
      output: payload,
      error: payload?.error || `Executor request failed (${response.status})`,
    };
  }

  return {
    result_status: inferResultStatus(payload),
    output: payload,
    error: payload?.error,
  };
}

// POST /api/hydi/tasks/execute-next - Durable queue worker tick
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = getTraceId(request);
  try {
    if (isExecutionKillSwitchEnabled()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Execution blocked by kill switch',
          traceId,
        },
        { status: 503, headers: buildTraceHeaders(traceId) }
      );
    }

    const workerId = request.headers.get('x-worker-id') || 'ursula-worker';
    const query = request.nextUrl.searchParams;
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const filters: ExecuteFilters = {
      system:
        typeof body?.system === 'string'
          ? body.system.toLowerCase()
          : typeof query.get('system') === 'string'
            ? query.get('system')!.toLowerCase()
            : undefined,
      source:
        typeof body?.source === 'string'
          ? body.source.toLowerCase()
          : typeof query.get('source') === 'string'
            ? query.get('source')!.toLowerCase()
            : undefined,
      type:
        typeof body?.type === 'string'
          ? body.type.toLowerCase()
          : typeof query.get('type') === 'string'
            ? query.get('type')!.toLowerCase()
            : undefined,
    };

    const tasks = await loadHydiTasks();
    const task = pickNextRunnableTask(tasks, filters);

    if (!task) {
      return NextResponse.json(
        {
          success: false,
          idle: true,
          message: 'No queued tasks available for requested filters',
          filters,
          traceId,
        },
        { headers: buildTraceHeaders(traceId) }
      );
    }

    // Respect global safety valves before running.
    const safety = GlobalSafetyValves.getInstance().canAcceptTask(task);
    if (!safety.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: safety.reason || 'System safety valve rejected execution',
          task_id: task.task_id,
          traceId,
        },
        { status: 429, headers: buildTraceHeaders(traceId) }
      );
    }

    const runTransition = TaskGovernance.governTaskUpdate(task, { status: 'running' });
    if (!runTransition.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Task could not transition to running',
          violations: runTransition.errors,
          task_id: task.task_id,
          traceId,
        },
        { status: 409, headers: buildTraceHeaders(traceId) }
      );
    }

    const runningTask = await updateHydiTask(task.task_id, {
      ...runTransition.sanitizedUpdates,
      locked_by: workerId,
      claimed_at: new Date().toISOString(),
    });

    const execution = await executeTask(runningTask, traceId);
    const finalTransition = TaskGovernance.governTaskUpdate(runningTask, {
      status: execution.result_status,
    });

    if (!finalTransition.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Task could not transition to final state',
          violations: finalTransition.errors,
          task_id: task.task_id,
          traceId,
        },
        { status: 409, headers: buildTraceHeaders(traceId) }
      );
    }

    const updated = await updateHydiTask(task.task_id, {
      ...finalTransition.sanitizedUpdates,
      result: execution.output,
      error: execution.error,
      completed_at:
        execution.result_status === 'completed' ||
        execution.result_status === 'failed_retryable' ||
        execution.result_status === 'failed_terminal'
          ? new Date().toISOString()
          : undefined,
    });

    if (execution.result_status === 'failed_terminal') {
      await HumanReviewPipeline.createEscalation(
        updated.task_id,
        'execution_failure',
        'high',
        `Terminal failure for task ${updated.task_id}`,
        execution.error || 'Task execution failed permanently',
        {
          task_id: updated.task_id,
          task_title: updated.title,
          result: execution.output,
        }
      );
    }

    if (execution.result_status === 'failed_retryable' || execution.result_status === 'failed_terminal') {
      learnFromFailure({
        type: execution.result_status === 'failed_terminal' ? 'policy_breach' : 'resource_limit',
        intent_id: updated.task_id,
        severity: execution.result_status === 'failed_terminal' ? 0.9 : 0.5,
        context: {
          task_id: updated.task_id,
          task_type: updated.type,
          error: execution.error,
        },
      });
    }

    // Publish result to the HYDI stream for downstream consumers (fire-and-forget)
    const stream = getStreamConsumer();
    const resultStream = execution.result_status === 'completed' ? 'hydi:task-results' : 'hydi:task-failures';
    stream.publish(resultStream, {
      task_id: updated.task_id,
      task_type: updated.type,
      result_status: execution.result_status,
      trace_id: traceId,
      worker_id: workerId,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    // Trigger Claude self-healing on failure (fire-and-forget)
    if (execution.result_status !== 'completed') {
      getHealingService().diagnoseAndCorrect({
        taskId: updated.task_id,
        taskType: updated.type,
        error: execution.error || 'Task execution failed',
        resultStatus: execution.result_status,
        traceId,
      }).then(heal => {
        if (heal) console.log(`[EXECUTE-NEXT] Claude correction for ${updated.task_id}: ${heal.root_cause}`);
      }).catch(() => {});
    }

    return NextResponse.json({
      success: execution.result_status === 'completed',
      task: updated,
      worker_id: workerId,
      result_status: execution.result_status,
      idle: false,
      filters,
      traceId,
    }, { headers: buildTraceHeaders(traceId) });
  } catch (error) {
    console.error('[HYDI-EXECUTOR] execute-next error:', error);
    return NextResponse.json(
      {
        error: 'Failed to execute next task',
        details: error instanceof Error ? error.message : 'Unknown error',
        traceId,
      },
      { status: 500, headers: buildTraceHeaders(traceId) }
    );
  }
}
