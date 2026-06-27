import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export async function GET(): Promise<NextResponse> {
  let redis: Redis | null = null;
  try {
    redis = Redis.fromEnv();
  } catch (error) {
    return NextResponse.json({ error: 'Redis not configured' });
  }

  try {
    // Check Redis connection
    const testKey = `test:${Date.now()}`;
    await redis.set(testKey as string, 'working', { ex: 60 });
    const testValue = await redis.get(testKey as string);
    await redis.del(testKey as string);

    // List all task keys
    const taskKeys = await redis.keys('task:*' as string);
    
    // Get sample task data
    let sampleTask = null;
    if (taskKeys.length > 0) {
      sampleTask = await redis.get(taskKeys[0] as string);
    }

    return NextResponse.json({
      redis_test: testValue === 'working' ? 'success' : 'failed',
      task_keys_count: taskKeys.length,
      task_keys: taskKeys.slice(0, 5),
      sample_task: sampleTask
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
