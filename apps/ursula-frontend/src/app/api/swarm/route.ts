import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { decomposeGoal } from '@/lib/swarm/task-decomposer';
import { runSwarm } from '@/lib/swarm/swarm-coordinator';

// POST /api/swarm — decompose a goal into a task DAG and execute it
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!goal) {
    return NextResponse.json({ error: 'goal is required' }, { status: 400 });
  }

  const context = typeof body.context === 'object' && body.context !== null
    ? body.context as Record<string, unknown>
    : undefined;

  const swarmId = `swarm_${randomUUID().slice(0, 8)}`;

  try {
    const dag = await decomposeGoal(goal, context);
    const result = await runSwarm(dag, swarmId);

    return NextResponse.json({
      success: result.success,
      swarm_id: swarmId,
      goal,
      synthesis: result.synthesis,
      task_count: result.taskResults.length,
      tasks_succeeded: result.taskResults.filter(t => t.success).length,
      duration_ms: result.durationMs,
      dag_reasoning: dag.reasoning,
      task_results: result.taskResults,
    });
  } catch (error) {
    console.error('[SWARM] Error:', error);
    return NextResponse.json(
      {
        error: 'Swarm execution failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        swarm_id: swarmId,
      },
      { status: 500 }
    );
  }
}

// GET /api/swarm — health check
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', endpoint: 'swarm', version: '1.0.0' });
}
