import { NextRequest, NextResponse } from 'next/server';
import { runHeidiLoop, IntentInput } from '@/lib/heidi-loop-engine';
import { TaskGovernance } from '@/lib/governance';
import { appendHydiTask, getHydiTaskById } from '@/lib/hydi-task-store';
import { toStorageTaskStatus, normalizeTaskForApi } from '@/lib/task-status';
import { randomUUID } from 'crypto';
import type { UDPTaskCore } from '@/types/task';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_TO_NUM: Record<Priority, number> = {
  low: 2,
  medium: 5,
  high: 8,
  urgent: 10,
};

function parsePriority(raw: unknown): Priority {
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'urgent') {
    return raw;
  }
  return 'medium';
}

function parseComplexity(raw: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH') return raw;
  return 'MEDIUM';
}

function parseRisk(raw: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH') return raw;
  return 'MEDIUM';
}

function mapPriorityToUrgency(priority: Priority): number {
  if (priority === 'urgent') return 10;
  if (priority === 'high') return 8;
  if (priority === 'medium') return 5;
  return 3;
}

function toTaskType(raw: unknown): UDPTaskCore['type'] {
  const candidate = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (candidate === 'build' || candidate === 'fix' || candidate === 'test' || candidate === 'deploy' || candidate === 'research' || candidate === 'validate') {
    return candidate;
  }
  return 'research';
}

function toTaskSystem(raw: unknown): UDPTaskCore['system'] {
  const candidate = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (candidate === 'revenue_pipeline' || candidate === 'music_ai' || candidate === 'robotics' || candidate === 'forgefinder' || candidate === 'general') {
    return candidate;
  }
  return 'general';
}

/**
 * POST /api/hydi/heidi/generate
 * Heidi planner evaluates intent and (when allowed) writes canonical Ursula task.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const {
      description,
      strategy,
      heidi_confidence,
      task,
      context,
    } = body ?? {};

    if (!description || !strategy) {
      return NextResponse.json(
        { error: 'description and strategy are required' },
        { status: 400 }
      );
    }

    const intentInput: IntentInput = {
      description,
      strategy,
      heidi_confidence: typeof heidi_confidence === 'number' ? heidi_confidence : 0.5,
      cpu_required: typeof context?.cpu_required === 'number' ? context.cpu_required : 0.5,
      time_required: typeof context?.time_required === 'number' ? context.time_required : 1200,
      risk_level: parseRisk(context?.risk_level),
      complexity: parseComplexity(context?.complexity),
    };

    const loopResult = runHeidiLoop(intentInput);
    if (!loopResult.allowed) {
      return NextResponse.json({
        allowed: false,
        simulation: loopResult.simulation,
        decision_reason: loopResult.decision_reason,
      });
    }

    const priority = parsePriority(task?.priority);
    const taskType = toTaskType(task?.type);
    const taskSystem = toTaskSystem(task?.system);
    const taskTitle =
      typeof task?.title === 'string' && task.title.trim().length > 0
        ? task.title.trim()
        : description.slice(0, 120);
    const taskDescription =
      typeof task?.description === 'string' && task.description.trim().length > 0
        ? task.description
        : description;

    const canonicalTask: Omit<UDPTaskCore, 'task_id' | 'created_at' | 'updated_at'> = {
      source: 'heidi',
      system: taskSystem,
      type: taskType,
      title: taskTitle,
      description: taskDescription,
      inputs: {
        description,
        strategy,
        context: context || {},
      },
      outputs_expected: task?.outputs_expected || {},
      dependencies: Array.isArray(task?.dependencies) ? task.dependencies : [],
      priority: PRIORITY_TO_NUM[priority],
      urgency: mapPriorityToUrgency(priority),
      revenue_impact: {
        stage: 'partial',
        value: typeof task?.revenue_impact?.value === 'number' ? task.revenue_impact.value : 0,
      },
      status: 'planned',
      retry_count: 0,
      state_version: 1,
      ursula_execution_id: undefined,
      ursula_ledger_entry_id: undefined,
      ursula_payment_intent_id: undefined,
      ursula_execution_state: undefined,
      ursula_cost: undefined,
      billing_status: undefined,
    };

    const validation = TaskGovernance.validateTaskCreation(canonicalTask);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Task validation failed', details: validation.error },
        { status: 400 }
      );
    }

    const taskId = randomUUID();
    const createdTask: UDPTaskCore = {
      ...canonicalTask,
      task_id: taskId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await appendHydiTask(createdTask);
    const created = await getHydiTaskById(taskId);
    if (!created) {
      return NextResponse.json(
        { error: 'Task was created but could not be loaded' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      allowed: true,
      simulation: loopResult.simulation,
      decision_reason: loopResult.decision_reason,
      task: normalizeTaskForApi(created),
    });
  } catch (error) {
    console.error('[HEIDI-GENERATE] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate task from Heidi intent',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
