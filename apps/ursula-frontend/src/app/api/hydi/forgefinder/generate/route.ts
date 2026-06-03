import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { runHeidiLoop, type IntentInput } from '@/lib/heidi-loop-engine';
import { TaskGovernance } from '@/lib/governance';
import { appendHydiTask, getHydiTaskById } from '@/lib/hydi-task-store';
import { normalizeTaskForApi } from '@/lib/task-status';
import type { UDPTaskCore } from '@/types/task';

type ForgeFinderPriority = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_TO_NUM: Record<ForgeFinderPriority, number> = {
  low: 2,
  medium: 5,
  high: 8,
  urgent: 10,
};

function parsePriority(raw: unknown): ForgeFinderPriority {
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'urgent') {
    return raw;
  }
  return 'medium';
}

/**
 * POST /api/hydi/forgefinder/generate
 * ForgeFinder-first planner entrypoint:
 * creates a canonical Ursula task scoped to the ForgeFinder vertical.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const priority = parsePriority(body?.task?.priority ?? body?.priority);
    const description = (body?.objective || body?.query || body?.description || '').toString().trim();

    if (!description) {
      return NextResponse.json(
        { error: 'objective (or query/description) is required' },
        { status: 400 }
      );
    }

    const strategy = (body?.strategy || 'forgefinder-asset-discovery').toString();
    const intentInput: IntentInput = {
      description,
      strategy,
      heidi_confidence: typeof body?.heidi_confidence === 'number' ? body.heidi_confidence : 0.75,
      cpu_required: typeof body?.cpu_required === 'number' ? body.cpu_required : 0.45,
      time_required: typeof body?.time_required === 'number' ? body.time_required : 1600,
      risk_level: body?.risk_level === 'LOW' || body?.risk_level === 'HIGH' ? body.risk_level : 'MEDIUM',
      complexity: body?.complexity === 'LOW' || body?.complexity === 'HIGH' ? body.complexity : 'MEDIUM',
    };

    const loop = runHeidiLoop(intentInput);
    if (!loop.allowed) {
      return NextResponse.json({
        allowed: false,
        decision_reason: loop.decision_reason,
        simulation: loop.simulation,
      });
    }

    const now = new Date().toISOString();
    const taskId = randomUUID();

    const task: UDPTaskCore = {
      task_id: taskId,
      source: 'heidi',
      system: 'forgefinder',
      type: 'research',
      title: body?.title?.toString()?.trim() || `[ForgeFinder] ${description.slice(0, 96)}`,
      description,
      inputs: {
        objective: description,
        strategy,
        jurisdiction: body?.jurisdiction || 'us',
        claimant_name: body?.claimant_name || null,
        claimant_company: body?.claimant_company || null,
        context: body?.context || {},
      },
      outputs_expected: body?.outputs_expected || {
        findings: [],
        confidence: 0,
        recommended_actions: [],
      },
      dependencies: Array.isArray(body?.dependencies) ? body.dependencies : [],
      priority: PRIORITY_TO_NUM[priority],
      urgency: PRIORITY_TO_NUM[priority],
      revenue_impact: {
        stage: 'partial',
        value: typeof body?.revenue_impact?.value === 'number' ? body.revenue_impact.value : 60,
      },
      status: 'planned',
      retry_count: 0,
      created_at: now,
      updated_at: now,
      state_version: 1,
      ursula_execution_id: undefined,
      ursula_ledger_entry_id: undefined,
      ursula_payment_intent_id: undefined,
      ursula_execution_state: undefined,
      ursula_cost: undefined,
      billing_status: undefined,
    };

    const validation = TaskGovernance.validateTaskCreation(task);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Task validation failed', details: validation.error },
        { status: 400 }
      );
    }

    await appendHydiTask(task);
    const persisted = await getHydiTaskById(taskId);

    return NextResponse.json({
      allowed: true,
      decision_reason: loop.decision_reason,
      simulation: loop.simulation,
      task: persisted ? normalizeTaskForApi(persisted) : normalizeTaskForApi(task),
      vertical: 'forgefinder',
    });
  } catch (error) {
    console.error('[FORGEFINDER-GENERATE] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate ForgeFinder task',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
