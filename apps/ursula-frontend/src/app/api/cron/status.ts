import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/cron-scheduler';

export async function GET(request: NextRequest) {
  try {
    const status = scheduler.getTaskStatus();
    
    return NextResponse.json({
      scheduler: 'cron_scheduler',
      timestamp: new Date().toISOString(),
      status: status
    });
  } catch (error) {
    console.error('[CRON] Status check failed:', error);
    return NextResponse.json(
      { error: 'Status check failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, taskId } = body;

    switch (action) {
      case 'enable':
        scheduler.enableTask(taskId);
        break;
      case 'disable':
        scheduler.disableTask(taskId);
        break;
      case 'trigger':
        await scheduler.triggerTask(taskId);
        break;
      case 'start':
        scheduler.start();
        break;
      case 'stop':
        scheduler.stop();
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      action: action,
      taskId: taskId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[CRON] Action failed:', error);
    return NextResponse.json(
      { error: 'Action failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}
