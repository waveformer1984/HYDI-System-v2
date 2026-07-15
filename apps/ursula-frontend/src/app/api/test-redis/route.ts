import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let redis: Redis | null = null;
  try {
    redis = Redis.fromEnv();
  } catch (error) {
    return NextResponse.json({ error: 'Redis not configured' });
  }

  try {
    // Test Redis connection
    const testKey = `test:${Date.now()}`;
    await redis.set(testKey, 'working', { ex: 60 });
    const testValue = await redis.get(testKey);
    await redis.del(testKey);

    // List all task keys
    const taskKeys = await redis.keys('task:*');
    
    return NextResponse.json({
      redis_test: testValue === 'working' ? 'success' : 'failed',
      task_keys_count: taskKeys.length,
      task_keys: taskKeys.slice(0, 5) // First 5 keys
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
