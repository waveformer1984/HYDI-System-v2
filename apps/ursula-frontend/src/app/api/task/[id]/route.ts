import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await context.params;

  let redis: Redis | null = null;
  try {
    redis = Redis.fromEnv();
  } catch (error) {
    console.warn('[REDIS] Redis not configured, using fallback');
  }

  try {
    let taskData: string | null = null;

    // Read task from Redis by key task:{task_id}
    if (redis) {
      taskData = await redis.get(`task:${taskId}`);
    } else {
      // Fallback - return mock data for testing
      console.log('[FALLBACK] Redis not available, returning mock task');
      return NextResponse.json({
        success: true,
        task_id: taskId,
        task_type: 'follow_up_task',
        task_status: 'queued',
        confidence: 0.9,
        message: 'follow up with detailing client tomorrow',
        user: 'test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        timestamp: Date.now(),
        fallback: true
      });
    }

    if (taskData) {
      // Redis might return object instead of string
      const task = typeof taskData === 'string' ? JSON.parse(taskData) : taskData;

      return NextResponse.json({
        success: true,
        task_id: task.id,
        task_type: task.intent,
        task_status: task.status,
        confidence: task.confidence,
        message: task.message,
        user: task.user,
        created_at: task.created_at,
        updated_at: task.updated_at,
        timestamp: Date.now(),
        payment_context: task.payment_context || null,
        source: task.source || 'unknown',
        event_id: task.event_id || null
      });
    } else {
      return NextResponse.json({
        error: 'Task not found',
        task_id: taskId,
        task_status: 'not_found'
      }, { status: 404 });
    }
  } catch (error) {
    console.error('[TASK STATUS] Redis error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      task_id: taskId,
      task_status: 'error'
    }, { status: 500 });
  }
}
