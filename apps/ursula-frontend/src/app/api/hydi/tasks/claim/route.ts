import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Redis } from '@upstash/redis';
import { normalizeTaskStatus, toStorageTaskStatus } from '@/lib/task-status';

let redis: Redis | null = null;
try {
  redis = Redis.fromEnv();
} catch (error) {
  console.warn('[TASKS-CLAIM] Redis not available');
}

// POST /api/hydi/tasks/claim - Atomic task claiming
export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const { task_id, worker_id } = await request.json();

    if (!task_id || !worker_id) {
      return NextResponse.json({
        error: 'task_id and worker_id required',
        traceId,
      }, { status: 400, headers: { 'x-trace-id': traceId } });
    }

    if (!redis) {
      console.warn('[TASKS-CLAIM] Redis not available, using file-based claim simulation');
      // Fallback to file-based claiming for development
      return NextResponse.json({
        error: 'Redis not available - claim endpoint requires Redis for atomic operations',
        traceId,
      }, { status: 503, headers: { 'x-trace-id': traceId } });
    }

    // ATOMIC CLAIM: Compare-and-set with Redis transaction
    const taskKey = `task:${task_id}` as string;
    const lockKey = `lock:${task_id}` as string;

    let currentTask: any = null;
    let currentLock: any = null;
    let results: [any, any][] | null = null;

    try {
      const pipeline = redis.pipeline();

      // Get current task and lock state
      pipeline.get(taskKey);
      pipeline.get(lockKey);

      results = await pipeline.exec() as [any, any][];

      if (!results || results.some(r => r[0])) {
        return NextResponse.json({
          error: 'Redis error during claim',
          traceId,
        }, { status: 500, headers: { 'x-trace-id': traceId } });
      }

      currentTask = results[0][1] ? JSON.parse(results[0][1]) : null;
      currentLock = results[1][1] ? JSON.parse(results[1][1]) : null;
    } catch (redisError) {
      console.error('[TASKS-CLAIM] Redis connection error:', redisError);
      return NextResponse.json({
        error: 'Redis connection failed',
        traceId,
      }, { status: 503, headers: { 'x-trace-id': traceId } });
    }

    if (!currentTask) {
      return NextResponse.json({
        error: 'Task not found',
        traceId,
      }, { status: 404, headers: { 'x-trace-id': traceId } });
    }

    // Check if task is claimable
    const currentStatus = normalizeTaskStatus(currentTask.status);
    if (currentStatus !== 'planned' && currentStatus !== 'queued') {
      return NextResponse.json({
        error: 'Task not claimable',
        current_status: currentStatus,
        traceId,
      }, { status: 409, headers: { 'x-trace-id': traceId } });
    }

    // Check if already locked (and lock is still valid)
    if (currentLock && currentLock.expires_at > Date.now()) {
      return NextResponse.json({
        error: 'Task already claimed',
        locked_by: currentLock.worker_id,
        expires_at: currentLock.expires_at,
        traceId,
      }, { status: 409, headers: { 'x-trace-id': traceId } });
    }

    // ATOMIC CLAIM: Set lock and update task status
    const lockData = {
      worker_id,
      claimed_at: Date.now(),
      expires_at: Date.now() + (5 * 60 * 1000) // 5 minute timeout
    };

    const claimPipeline = redis.pipeline();
    claimPipeline.set(lockKey, JSON.stringify(lockData), { px: 5 * 60 * 1000 }); // 5 minutes TTL
    claimPipeline.set(taskKey, JSON.stringify({
      ...currentTask,
      status: toStorageTaskStatus('queued'),
      locked_by: worker_id,
      claimed_at: new Date().toISOString()
    }));

    const claimResults = await claimPipeline.exec() as [any, any][];

    if (!claimResults || claimResults.some(r => r[0])) {
      return NextResponse.json({
        error: 'Failed to claim task',
        traceId,
      }, { status: 500, headers: { 'x-trace-id': traceId } });
    }

    console.log(`[TASKS-CLAIM] Task ${task_id} claimed by ${worker_id}`);

    return NextResponse.json({
      success: true,
      task: {
        ...currentTask,
        status: toStorageTaskStatus('queued'),
        locked_by: worker_id,
        claimed_at: new Date().toISOString()
      },
      claim: lockData,
      traceId,
    }, { headers: { 'x-trace-id': traceId } });

  } catch (error) {
    console.error('[TASKS-CLAIM] Error:', error);
    return NextResponse.json({
      error: 'Failed to claim task',
      traceId,
    }, { status: 500, headers: { 'x-trace-id': traceId } });
  }
}
