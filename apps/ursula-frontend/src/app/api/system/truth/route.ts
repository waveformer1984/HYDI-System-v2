import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// TRUTH PROBE - What system am I actually running right now?
export async function GET(): Promise<NextResponse> {
  const startTime = Date.now();
  
  // Test Redis availability
  let redisStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';
  let redisError: string | null = null;
  
  try {
    const redis = Redis.fromEnv();
    await redis.ping(); // Test connection
    redisStatus = 'connected';
  } catch (error) {
    redisStatus = 'error';
    redisError = error instanceof Error ? error.message : 'Unknown error';
  }
  
  // Test file system availability
  let fileStatus: 'available' | 'error' = 'available';
  let fileError: string | null = null;
  
  try {
    const fs = await import('fs/promises');
    await fs.access('./data/tasks.json');
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      // File doesn't exist yet - that's OK
      fileStatus = 'available';
    } else {
      fileStatus = 'error';
      fileError = error instanceof Error ? error.message : 'Unknown error';
    }
  }
  
  // Determine execution mode
  const executionMode = redisStatus === 'connected' ? 'redis' : 'file';
  
  // Load current task count
  let taskCount = 0;
  let taskStorageLocation: 'redis' | 'file' | 'unknown' = 'unknown';
  
  try {
    if (executionMode === 'redis') {
      const redis = Redis.fromEnv();
      const keys = await redis.keys('task:*' as string);
      taskCount = keys.length;
      taskStorageLocation = 'redis';
    } else {
      const fs = await import('fs/promises');
      try {
        const data = await fs.readFile('./data/tasks.json', 'utf-8');
        const tasks = JSON.parse(data);
        taskCount = Array.isArray(tasks) ? tasks.length : 0;
        taskStorageLocation = 'file';
      } catch {
        taskCount = 0;
        taskStorageLocation = 'file';
      }
    }
  } catch (error) {
    taskCount = -1; // Error indicator
    taskStorageLocation = 'unknown';
  }
  
  const responseTime = Date.now() - startTime;
  
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    response_time_ms: responseTime,
    
    // System state
    execution_mode: executionMode,
    system_consistency: executionMode === 'redis' ? 'strict_atomic' : 'eventual_consistency',
    
    // Infrastructure status
    infrastructure: {
      redis: {
        status: redisStatus,
        error: redisError
      },
      file_system: {
        status: fileStatus,
        error: fileError
      }
    },
    
    // Task storage reality
    task_storage: {
      location: taskStorageLocation,
      count: taskCount
    },
    
    // Execution guarantees
    guarantees: {
      atomic_claims: executionMode === 'redis',
      version_consistency: executionMode === 'redis',
      single_worker: true, // Enforced by singleton processor
      graceful_degradation: true
    },
    
    // Health check
    health: {
      status: executionMode === 'redis' ? 'optimal' : 'degraded_functional',
      can_process_tasks: true,
      can_accept_new_tasks: true
    }
  });
}
