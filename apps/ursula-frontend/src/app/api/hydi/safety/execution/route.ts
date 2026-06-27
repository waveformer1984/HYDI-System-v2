import { NextRequest, NextResponse } from 'next/server';
import { GlobalSafetyValves } from '@/lib/global-safety-valves';

// POST /api/hydi/safety/execution - Register task execution for safety metrics
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const executionData = await request.json();
    
    // Validate required fields
    if (!executionData.task_id || !executionData.task_type || !executionData.status) {
      return NextResponse.json({ 
        error: 'Missing required fields: task_id, task_type, status' 
      }, { status: 400 });
    }

    const safetyValves = GlobalSafetyValves.getInstance();
    
    // Register the execution for metrics tracking
    safetyValves.registerTaskExecution(executionData, executionData);
    
    // Get updated metrics
    const metrics = safetyValves.getMetrics();

    return NextResponse.json({
      message: 'Execution registered',
      metrics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SAFETY-EXECUTION] Error registering execution:', error);
    return NextResponse.json({ 
      error: 'Failed to register execution' 
    }, { status: 500 });
  }
}

// GET /api/hydi/safety/execution - Get execution metrics
export async function GET(): Promise<NextResponse> {
  try {
    const safetyValves = GlobalSafetyValves.getInstance();
    const metrics = safetyValves.getMetrics();
    const quarantined = safetyValves.getQuarantinedTypes();

    return NextResponse.json({
      metrics,
      quarantined_types: Object.fromEntries(quarantined),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SAFETY-EXECUTION] Error getting metrics:', error);
    return NextResponse.json({ 
      error: 'Failed to get execution metrics' 
    }, { status: 500 });
  }
}
