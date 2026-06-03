/**
 * SWARM COORDINATOR
 * Orchestrates DAG execution: resolves dependencies, dispatches sub-tasks
 * to the appropriate executor stream, and synthesizes the final result.
 */

import { type TaskDAG, type SubTask } from './task-decomposer';
import { getStreamConsumer } from '@/lib/queue/stream-consumer';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface SwarmResult {
  swarmId: string;
  goal: string;
  success: boolean;
  synthesis: string;
  taskResults: TaskResult[];
  durationMs: number;
}

async function dispatchSubTask(task: SubTask, swarmId: string): Promise<TaskResult> {
  const stream = getStreamConsumer();

  if (task.strategy === 'edge') {
    const msgId = await stream.publish('hydi:edge-tasks', {
      swarmId,
      taskId: task.id,
      type: task.type,
      instruction: task.instruction,
      priority: task.priority,
      timestamp: new Date().toISOString(),
    });
    if (!msgId) {
      return { taskId: task.id, success: false, error: 'Edge stream unavailable' };
    }

    // Poll hydi:edge-results for this task's result (max 30s)
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      const messages = await stream.peek('hydi:edge-results', 20);
      const found = messages.find(m => m.data.taskId === task.id && m.data.swarmId === swarmId);
      if (found) {
        return {
          taskId: task.id,
          success: found.data.success === true,
          output: found.data.output,
          error: typeof found.data.error === 'string' ? found.data.error : undefined,
        };
      }
    }
    return { taskId: task.id, success: false, error: 'Edge task timed out' };
  }

  const executorUrl = process.env.HYDI_EXECUTOR_URL || process.env.URSULA_EXECUTOR_URL;
  if (!executorUrl) {
    return { taskId: task.id, success: false, error: 'No executor URL configured' };
  }

  try {
    const res = await fetch(executorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-swarm-id': swarmId },
      body: JSON.stringify({
        task_id: `${swarmId}-${task.id}`,
        type: task.type,
        description: task.instruction,
        priority: task.priority,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await res.json().catch(() => ({}));
    return {
      taskId: task.id,
      success: res.ok && (payload as Record<string, unknown>)?.success !== false,
      output: payload,
      error: !res.ok ? (payload as Record<string, unknown>)?.error as string : undefined,
    };
  } catch (e) {
    return {
      taskId: task.id,
      success: false,
      error: e instanceof Error ? e.message : 'Dispatch error',
    };
  }
}

async function synthesizeResults(goal: string, taskResults: TaskResult[]): Promise<string> {
  if (!ANTHROPIC_API_KEY) return 'Swarm execution complete.';
  try {
    const payload = JSON.stringify({ goal, taskResults }, null, 2).slice(0, 4000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 1024,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: `You are Ursula's synthesis engine. Given a goal and the results of a multi-agent swarm execution,
produce a concise operator summary (2-4 sentences) describing what was accomplished, what failed, and any required follow-up.`,
        messages: [{ role: 'user', content: payload }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return 'Swarm execution complete.';
    const data = await res.json();
    const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === 'text') as { type: string; text: string } | undefined;
    return textBlock?.text ?? 'Swarm execution complete.';
  } catch {
    return 'Swarm execution complete.';
  }
}

export async function runSwarm(dag: TaskDAG, swarmId: string): Promise<SwarmResult> {
  const start = Date.now();
  const completed = new Map<string, TaskResult>();
  const pending = [...dag.tasks];
  const stream = getStreamConsumer();

  await stream.publish('hydi:task-results', {
    swarmId,
    event: 'swarm_start',
    goal: dag.goal,
    taskCount: dag.tasks.length,
    timestamp: new Date().toISOString(),
  });

  while (pending.length > 0) {
    const wave: SubTask[] = pending.filter(t =>
      t.depends_on.every(dep => completed.has(dep) && completed.get(dep)!.success)
    );

    if (wave.length === 0) {
      for (const t of pending) {
        if (!completed.has(t.id)) {
          completed.set(t.id, { taskId: t.id, success: false, error: 'Dependency failed' });
        }
      }
      break;
    }

    const waveResults = await Promise.all(wave.map(t => dispatchSubTask(t, swarmId)));
    for (const r of waveResults) {
      completed.set(r.taskId, r);
      const idx = pending.findIndex(t => t.id === r.taskId);
      if (idx !== -1) pending.splice(idx, 1);
    }
  }

  const taskResults = Array.from(completed.values());
  const allSucceeded = taskResults.every(r => r.success);
  const synthesis = await synthesizeResults(dag.goal, taskResults);

  await stream.publish('hydi:task-results', {
    swarmId,
    event: 'swarm_complete',
    goal: dag.goal,
    success: allSucceeded,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  });

  return {
    swarmId,
    goal: dag.goal,
    success: allSucceeded,
    synthesis,
    taskResults,
    durationMs: Date.now() - start,
  };
}
