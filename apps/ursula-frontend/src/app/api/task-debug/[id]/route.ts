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
    console.warn('[REDIS] Redis not configured');
  }

  try {
    if (redis) {
      console.log(`[DEBUG] Testing Redis connection...`);

      // Test Redis connection
      const testKey = `test:debug:${Date.now()}`;
      await redis.set(testKey, 'working', { ex: 60 });
      const testValue = await redis.get(testKey);
      await redis.del(testKey);

      console.log(`[DEBUG] Redis test: ${testValue}`);

      // Check if task exists
      console.log(`[DEBUG] Looking for task: ${taskId}`);
      const taskKey = `task:${taskId}`;
      const taskData = await redis.get(taskKey);

      console.log(`[DEBUG] Task data found:`, !!taskData);

      if (taskData) {
        console.log(`[DEBUG] Task data length:`, (taskData as string).length);
        console.log(`[DEBUG] Task data preview:`, (taskData as string).substring(0, 100));

        try {
          const task = JSON.parse(taskData as string);
          console.log(`[DEBUG] Parsed task successfully`);
          console.log(`[DEBUG] Task fields:`, Object.keys(task));

          return NextResponse.json({
            success: true,
            redis_test: 'working',
            task_found: true,
            task_data: task,
            debug: {
              task_key: taskKey,
              data_length: (taskData as string).length,
              fields: Object.keys(task)
            }
          });
        } catch (parseError) {
          console.error(`[DEBUG] JSON parse error:`, parseError);
          return NextResponse.json({
            success: false,
            redis_test: 'working',
            task_found: true,
            error: 'JSON parse failed',
            raw_data: (taskData as string).substring(0, 200),
            debug: {
              task_key: taskKey,
              data_length: (taskData as string).length
            }
          });
        }
      } else {
        // List some keys to see what's in Redis
        const keys = await redis.keys('task:*');
        console.log(`[DEBUG] Found task keys:`, keys);

        return NextResponse.json({
          success: false,
          redis_test: 'working',
          task_found: false,
          available_keys: keys.slice(0, 10), // Limit to first 10
          debug: {
            task_key: taskKey,
            total_keys_found: keys.length
          }
        });
      }
    } else {
      return NextResponse.json({
        success: false,
        error: 'Redis not available',
        debug: {}
      });
    }
  } catch (error) {
    console.error('[DEBUG] Redis error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      debug: {}
    }, { status: 500 });
  }
}
