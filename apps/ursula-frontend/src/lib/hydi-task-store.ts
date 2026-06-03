import { randomUUID } from 'crypto';
import { Redis } from '@upstash/redis';
import { UDPTaskCore } from '@/types/task';
import { normalizeTaskForApi, normalizeTaskStatus, toStorageTaskStatus } from '@/lib/task-status';

const TASKS_FILE = './data/tasks.json';

let redis: Redis | null = null;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (redisUrl && redisToken) {
  try {
    redis = Redis.fromEnv();
  } catch {
    console.warn('[HYDI_TASK_STORE] Redis unavailable, using file fallback');
    redis = null;
  }
}

export type HydiStoredTask = UDPTaskCore;

function normalizeStoredTask<T extends { status?: string }>(task: T): T {
  const canonical = normalizeTaskStatus(task.status);
  return {
    ...task,
    status: toStorageTaskStatus(canonical),
  };
}

async function readFileTasks(): Promise<HydiStoredTask[]> {
  try {
    const fs = await import('fs/promises');
    const data = await fs.readFile(TASKS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileTasks(tasks: HydiStoredTask[]): Promise<void> {
  const fs = await import('fs/promises');
  await fs.mkdir('./data', { recursive: true });
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

export function hasRedisTaskStore(): boolean {
  return Boolean(redis);
}

export function validateTask(task: any): task is HydiStoredTask {
  return (
    task &&
    typeof task.task_id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.description === 'string' &&
    typeof task.system === 'string' &&
    typeof task.type === 'string' &&
    typeof task.status === 'string'
  );
}

export const validateHydiTask = validateTask;

export async function loadHydiTasks(): Promise<HydiStoredTask[]> {
  if (redis) {
    const keys = await redis.keys('task:*' as string);
    const tasks = await Promise.all(
      keys.map(async (key) => {
        const task = await redis!.get(key as string);
        if (!task) return null;
        const parsed = typeof task === 'string' ? JSON.parse(task) : task;
        return normalizeStoredTask(parsed);
      })
    );
    return tasks.filter(Boolean) as HydiStoredTask[];
  }

  const fileTasks = await readFileTasks();
  return fileTasks.map((task) => normalizeStoredTask(task));
}

export async function saveHydiTasks(tasks: HydiStoredTask[]): Promise<void> {
  const normalized = tasks.map((task) => normalizeStoredTask(task));

  if (redis) {
    await Promise.all(
      normalized.map((task) =>
        redis!.set(`task:${task.task_id}` as string, JSON.stringify(task))
      )
    );
    return;
  }

  await writeFileTasks(normalized);
}

export async function getHydiTaskById(taskId: string): Promise<HydiStoredTask | null> {
  if (redis) {
    const task = await redis.get(`task:${taskId}` as string);
    if (!task) return null;
    const parsed = typeof task === 'string' ? JSON.parse(task) : task;
    return normalizeStoredTask(parsed) as HydiStoredTask;
  }

  const tasks = await readFileTasks();
  const found = tasks.find((task) => task.task_id === taskId);
  return found ? (normalizeStoredTask(found) as HydiStoredTask) : null;
}

export async function upsertHydiTask(task: HydiStoredTask): Promise<void> {
  const normalizedTask = normalizeStoredTask(task) as HydiStoredTask;

  if (redis) {
    await redis.set(`task:${normalizedTask.task_id}` as string, JSON.stringify(normalizedTask));
    return;
  }

  const tasks = await readFileTasks();
  const taskIndex = tasks.findIndex((t) => t.task_id === normalizedTask.task_id);
  if (taskIndex === -1) {
    tasks.push(normalizedTask);
  } else {
    tasks[taskIndex] = normalizedTask;
  }
  await writeFileTasks(tasks);
}

export async function appendHydiTask(task: HydiStoredTask): Promise<void> {
  const normalizedTask = normalizeStoredTask(task) as HydiStoredTask;

  if (redis) {
    await redis.set(`task:${normalizedTask.task_id}` as string, JSON.stringify(normalizedTask));
    return;
  }

  const tasks = await readFileTasks();
  tasks.push(normalizedTask);
  await writeFileTasks(tasks);
}

export async function updateHydiTask(
  taskId: string,
  updates: Partial<HydiStoredTask>
): Promise<HydiStoredTask> {
  const current = await getHydiTaskById(taskId);
  if (!current) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const updatedTask: HydiStoredTask = normalizeStoredTask({
    ...current,
    ...updates,
    task_id: taskId,
    state_version:
      typeof updates.state_version === 'number'
        ? updates.state_version
        : (current.state_version || 0) + 1,
    updated_at: new Date().toISOString(),
  }) as HydiStoredTask;

  await upsertHydiTask(updatedTask);
  return updatedTask;
}

export async function updateHydiTaskById(
  taskId: string,
  task: HydiStoredTask
): Promise<void> {
  if (task.task_id !== taskId) {
    throw new Error(`task_id mismatch (${task.task_id} !== ${taskId})`);
  }
  await upsertHydiTask(task);
}

export async function createTask(
  task: Omit<HydiStoredTask, 'task_id' | 'created_at' | 'updated_at'>
): Promise<string> {
  const now = new Date().toISOString();
  const newTask: HydiStoredTask = {
    ...task,
    task_id: randomUUID(),
    created_at: now,
    updated_at: now,
  };
  await appendHydiTask(newTask);
  return newTask.task_id;
}

export function toHydiApiTask<T extends { status?: string }>(
  task: T
): T & { status: ReturnType<typeof normalizeTaskStatus>; raw_status?: string } {
  return normalizeTaskForApi(task);
}

// Backward-compatible aliases used across Ursula API routes.
export const loadTasks = loadHydiTasks;
export const saveTasks = saveHydiTasks;
export const listTasks = loadHydiTasks;
export const getTaskById = getHydiTaskById;
export const getTask = getHydiTaskById;
export const upsertTask = upsertHydiTask;
export const appendTask = appendHydiTask;
export const updateTaskById = updateHydiTask;
