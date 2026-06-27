/**
 * TASK DECOMPOSER
 * Uses Claude claude-opus-4-7 with adaptive thinking to break a complex goal
 * into a directed acyclic graph (DAG) of typed sub-tasks.
 */

export interface SubTask {
  id: string;
  type: string;
  instruction: string;
  priority: 'normal' | 'high' | 'critical';
  strategy: 'local' | 'external' | 'hybrid' | 'edge';
  depends_on: string[];
}

export interface TaskDAG {
  goal: string;
  reasoning: string;
  tasks: SubTask[];
}

const DECOMPOSE_SYSTEM = `You are the task decomposition engine for the HYDI/Ursula autonomous execution platform.
Given a high-level goal, decompose it into a directed acyclic graph (DAG) of atomic sub-tasks.

Rules:
- Each task must be independently executable once its dependencies complete
- Circular dependencies are forbidden
- Use "edge" strategy only for tasks requiring local filesystem, shell commands, or hardware access
- Be concise but specific in instructions
- Assign IDs as t1, t2, t3, ... in topological order (dependencies come first)

Respond ONLY with valid JSON:
{
  "goal": "original goal string",
  "reasoning": "one paragraph explaining the decomposition strategy",
  "tasks": [
    {
      "id": "t1",
      "type": "task_type_slug",
      "instruction": "precise instruction for the executor",
      "priority": "normal | high | critical",
      "strategy": "local | external | hybrid | edge",
      "depends_on": []
    }
  ]
}`;

async function callClaude(userContent: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: DECOMPOSE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === 'text') as { type: string; text: string } | undefined;
  return textBlock?.text ?? null;
}

export async function decomposeGoal(goal: string, context?: Record<string, unknown>): Promise<TaskDAG> {
  const userContent = JSON.stringify({ goal, context: context ?? {} }, null, 2);
  const raw = await callClaude(userContent);
  if (!raw) throw new Error('Claude returned no response');

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return valid JSON DAG');

  const dag = JSON.parse(match[0]) as TaskDAG;
  validateDAG(dag.tasks);
  return dag;
}

function validateDAG(tasks: SubTask[]): void {
  const ids = new Set(tasks.map(t => t.id));
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) throw new Error(`Task ${task.id} depends on unknown task ${dep}`);
    }
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.id, t.depends_on);

  function dfs(id: string) {
    if (inStack.has(id)) throw new Error(`Circular dependency detected at task ${id}`);
    if (visited.has(id)) return;
    inStack.add(id);
    for (const dep of adj.get(id) ?? []) dfs(dep);
    inStack.delete(id);
    visited.add(id);
  }

  for (const t of tasks) dfs(t.id);
}
