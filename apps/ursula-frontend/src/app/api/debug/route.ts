import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export async function GET(request: NextRequest): Promise<NextResponse> {
  console.log('[DEBUG] Checking Redis connection...');

  let redis: Redis | null = null;
  let redisStatus = 'not_initialized';
  let envVars = {};

  try {
    // Check environment variables (without exposing secrets)
    envVars = {
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ? 'SET' : 'NOT_SET',
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? 'SET' : 'NOT_SET',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT_SET',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? 'SET' : 'NOT_SET'
    };

    redis = Redis.fromEnv();
    redisStatus = 'initialized';

    // Test Redis connection
    const testKey = 'test:redis:connection:' + Date.now();
    await redis.set(testKey, 'working', { ex: 60 });
    const testValue = await redis.get(testKey);

    if (testValue === 'working') {
      redisStatus = 'connected_and_working';
    } else {
      redisStatus = 'connected_but_not_working';
    }

    // Clean up
    await redis.del(testKey);

  } catch (error) {
    redisStatus = 'error: ' + (error instanceof Error ? error.message : 'Unknown error');
    console.error('[DEBUG] Redis error:', error);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    redis_status: redisStatus,
    environment_variables: envVars,
    redis_available: redis !== null
  });
}
