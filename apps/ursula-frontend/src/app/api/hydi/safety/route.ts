import { NextRequest, NextResponse } from 'next/server';
import { GlobalSafetyValves } from '@/lib/global-safety-valves';

// GET /api/hydi/safety - Get system safety status
export async function GET(): Promise<NextResponse> {
  try {
    const safetyValves = GlobalSafetyValves.getInstance();
    const healthSummary = safetyValves.getHealthSummary();
    
    return NextResponse.json({
      safety_status: healthSummary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SAFETY] Error getting safety status:', error);
    return NextResponse.json({ 
      error: 'Failed to get safety status' 
    }, { status: 500 });
  }
}

// POST /api/hydi/safety - Control safety valves
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { action, reason } = await request.json();
    const safetyValves = GlobalSafetyValves.getInstance();

    switch (action) {
      case 'pause':
        safetyValves.pauseSystem(reason || 'Manual pause');
        break;
        
      case 'resume':
        safetyValves.resumeSystem();
        break;
        
      case 'degrade':
        safetyValves.setDegradedMode();
        break;
        
      case 'emergency':
        safetyValves.setEmergencyMode();
        break;
        
      case 'clear_quarantines':
        safetyValves.clearExpiredQuarantines();
        break;
        
      default:
        return NextResponse.json({ 
          error: `Unknown action: ${action}` 
        }, { status: 400 });
    }

    const updatedStatus = safetyValves.getHealthSummary();

    return NextResponse.json({
      message: `Safety action ${action} executed`,
      safety_status: updatedStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SAFETY] Error executing safety action:', error);
    return NextResponse.json({ 
      error: 'Failed to execute safety action' 
    }, { status: 500 });
  }
}

// PUT /api/hydi/safety - Update safety configuration
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const config = await request.json();
    const safetyValves = GlobalSafetyValves.getInstance();
    
    safetyValves.updateConfig(config);
    
    const updatedConfig = safetyValves.getHealthSummary();

    return NextResponse.json({
      message: 'Safety configuration updated',
      safety_status: updatedConfig,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SAFETY] Error updating safety config:', error);
    return NextResponse.json({ 
      error: 'Failed to update safety configuration' 
    }, { status: 500 });
  }
}
