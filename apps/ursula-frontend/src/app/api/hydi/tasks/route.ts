import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { UDPTaskCore } from '@/types/task';
import { TaskGovernance } from '@/lib/governance';
import { normalizeTaskForApi, normalizeTaskStatus, toStorageTaskStatus } from '@/lib/task-status';
import { loadHydiTasks, saveHydiTasks, validateHydiTask } from '@/lib/hydi-task-store';

// GET /api/hydi/tasks - List all tasks
export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const tasks = await loadHydiTasks();
    return NextResponse.json(
      { tasks: tasks.map((task) => normalizeTaskForApi(task)), traceId },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    console.error('[TASKS] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load tasks', traceId },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}

// POST /api/hydi/tasks - Create new task
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const taskData = await request.json();

    // Validate required fields
    if (!taskData.title || !taskData.description || !taskData.system || !taskData.type) {
      return NextResponse.json(
        { error: 'Title, description, system, and type required', traceId },
        { status: 400, headers: { 'x-trace-id': traceId } }
      );
    }

    // STRICT: All tasks must have state_version
    if (taskData.state_version === undefined) {
      taskData.state_version = 1; // Initialize to 1 for new tasks
    }

    const tasks = await loadHydiTasks();

    // Determine current execution mode
    const executionMode = process.env.UPSTASH_REDIS_REST_URL ? 'redis' : 'file';

    // Apply governance to new task
    const taskWithGovernance = {
      task_id: randomUUID(),
      source: "manual",
      system: taskData.system,
      type: taskData.type,
      title: taskData.title,
      description: taskData.description,
      inputs: taskData.inputs || {},
      outputs_expected: taskData.outputs_expected || {},
      dependencies: taskData.dependencies || [],
      priority: taskData.priority || 1,
      urgency: taskData.urgency || 1,
      revenue_impact: taskData.revenue_impact || { stage: "partial", value: 50 },
      status: toStorageTaskStatus(normalizeTaskStatus(taskData.status || 'planned')),
      state_version: taskData.state_version,
      retry_count: 0,
      max_retries: 3,
      fix_attempts: 0,
      max_fix_attempts: 3,
      execution_mode: executionMode,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Validate with governance
    const governance = TaskGovernance.governTaskUpdate({}, taskWithGovernance);
    if (!governance.allowed) {
      console.error('[GOVERNANCE] Task creation rejected:', governance.errors);
      return NextResponse.json({
        error: 'Task creation rejected by governance rules',
        violations: governance.errors,
        traceId,
      }, { status: 400, headers: { 'x-trace-id': traceId } });
    }

    const newTask: UDPTaskCore = governance.sanitizedUpdates as UDPTaskCore;

    // Validate task before saving
    if (!validateHydiTask(newTask)) {
      return NextResponse.json(
        { error: 'Invalid task structure', traceId },
        { status: 400, headers: { 'x-trace-id': traceId } }
      );
    }

    tasks.push(newTask);
    await saveHydiTasks(tasks);

    return NextResponse.json(
      { task: normalizeTaskForApi(newTask), traceId },
      { headers: { 'x-trace-id': traceId } }
    );
  } catch (error) {
    console.error('[TASKS] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create task', traceId },
      { status: 500, headers: { 'x-trace-id': traceId } }
    );
  }
}

// Note: PATCH moved to dynamic route [id]/route.ts
