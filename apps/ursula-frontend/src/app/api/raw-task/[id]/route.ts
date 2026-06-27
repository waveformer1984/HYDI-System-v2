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
    return NextResponse.json({ error: 'Redis not configured' });
  }

  try {
    if (redis) {
      const taskData = await redis.get(`task:${taskId}`);
      
      if (taskData) {
        // Return raw data without parsing
        return NextResponse.json({
          success: true,
          raw_data: taskData,
          data_type: typeof taskData
        });
      } else {
        return NextResponse.json({
          success: false,
          error: 'Task not found'
        });
      }
    } else {
      return NextResponse.json({ error: 'Redis not available' });
    }
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
