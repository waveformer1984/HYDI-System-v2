import { NextRequest, NextResponse } from 'next/server';

// GET /api/dashboard/status - Real-time system status verification
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    console.log('[DASHBOARD] Fetching real-time system status');
    
    // In production, would query actual systems
    // For now, simulate real data fetching
    
    // Get tasks from HYDI
    const hydiTasks = await fetchHydiTasks();
    
    // Get executions from Ursula
    const ursulaExecutions = await fetchUrsulaExecutions();
    
    // Get billing status
    const billingStatus = await fetchBillingStatus();
    
    // Derive real execution state
    const verifiedTasks = hydiTasks.map(task => {
      const execution = ursulaExecutions.find(ex => ex.id === task.ursula_execution_id);
      const billing = billingStatus.find(b => b.payment_intent_id === task.ursula_payment_intent_id);
      
      // Compute real execution status with confidence
      const executionStatus = computeExecutionStatus(task, execution, billing);
      
      return {
        ...task,
        verifiedStatus: executionStatus.status,
        confidence: executionStatus.confidence,
        lastVerified: new Date().toISOString(),
        crossChecks: {
          hydiStatus: task.status,
          ursulaStatus: execution?.status,
          billingStatus: billing?.status,
        },
      };
    });

    const systemStatus = {
      timestamp: new Date().toISOString(),
      totalTasks: verifiedTasks.length,
      executing: verifiedTasks.filter(t => t.verifiedStatus === 'EXECUTING').length,
      stalled: verifiedTasks.filter(t => t.verifiedStatus === 'STALLED').length,
      failed: verifiedTasks.filter(t => t.verifiedStatus === 'FAILED').length,
      completed: verifiedTasks.filter(t => t.verifiedStatus === 'COMPLETED').length,
      tasks: verifiedTasks,
      systemHealth: {
        hydiConnected: true,
        ursulaConnected: true,
        billingConnected: true,
        lastSync: new Date().toISOString(),
      },
    };

    console.log(`[DASHBOARD] Status: ${systemStatus.executing} executing, ${systemStatus.stalled} stalled, ${systemStatus.failed} failed`);

    return NextResponse.json(systemStatus);

  } catch (error) {
    console.error('[DASHBOARD] Failed to fetch status:', error);
    return NextResponse.json({
      error: 'Failed to fetch system status',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * Compute real execution status with confidence level
 */
function computeExecutionStatus(task: any, execution: any, billing: any): {
  status: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
} {
  // Rule 1: If HYDI says executing but no Ursula record, it's lying
  if (task.status === 'EXECUTING' && !execution) {
    return { status: 'STALLED', confidence: 'HIGH' };
  }
  
  // Rule 2: If Ursula says failed but HYDI still says executing, trust Ursula
  if (task.status === 'EXECUTING' && execution?.status === 'FAILED') {
    return { status: 'FAILED', confidence: 'HIGH' };
  }
  
  // Rule 3: If billing failed but execution succeeded, mark as billing issue
  if (task.status === 'COMPLETED' && billing?.status === 'FAILED') {
    return { status: 'BILLING_ISSUE', confidence: 'HIGH' };
  }
  
  // Rule 4: High confidence execution (all systems agree)
  if (
    task.status === 'EXECUTING' && 
    execution?.status === 'RUNNING' && 
    billing?.status !== 'failed'
  ) {
    return { status: 'EXECUTING', confidence: 'HIGH' };
  }
  
  // Rule 5: Medium confidence (HYDI + Ursula agree, billing unknown)
  if (
    task.status === 'EXECUTING' && 
    execution?.status === 'RUNNING'
  ) {
    return { status: 'EXECUTING', confidence: 'MEDIUM' };
  }
  
  // Rule 6: Low confidence (only HYDI says executing)
  if (task.status === 'EXECUTING') {
    return { status: 'EXECUTING', confidence: 'LOW' };
  }
  
  // Default: Use HYDI status with low confidence
  return { 
    status: task.status, 
    confidence: 'LOW' 
  };
}

/**
 * Fetch tasks from HYDI system
 */
async function fetchHydiTasks(): Promise<any[]> {
  try {
    // In production, would call HYDI API
    // For now, return mock data
    return [
      {
        task_id: 'task-123',
        status: 'EXECUTING',
        ursula_execution_id: 'ursula-exec-456',
        ursula_payment_intent_id: 'pi_abc123',
        billing_status: 'paid',
        created_at: new Date(Date.now() - 60000).toISOString(),
        updated_at: new Date(Date.now() - 30000).toISOString(),
      },
      {
        task_id: 'task-789',
        status: 'COMPLETED',
        ursula_execution_id: 'ursula-exec-790',
        ursula_payment_intent_id: 'pi_def456',
        billing_status: 'paid',
        created_at: new Date(Date.now() - 300000).toISOString(),
        updated_at: new Date(Date.now() - 240000).toISOString(),
      },
    ];
  } catch (error) {
    console.error('Failed to fetch HYDI tasks:', error);
    return [];
  }
}

/**
 * Fetch executions from Ursula system
 */
async function fetchUrsulaExecutions(): Promise<any[]> {
  try {
    // In production, would call Ursula API
    // For now, return mock data
    return [
      {
        id: 'ursula-exec-456',
        status: 'RUNNING',
        started_at: new Date(Date.now() - 30000).toISOString(),
        last_heartbeat: new Date(Date.now() - 5000).toISOString(),
      },
      {
        id: 'ursula-exec-790',
        status: 'COMPLETED',
        started_at: new Date(Date.now() - 240000).toISOString(),
        completed_at: new Date(Date.now() - 240000).toISOString(),
      },
    ];
  } catch (error) {
    console.error('Failed to fetch Ursula executions:', error);
    return [];
  }
}

/**
 * Fetch billing status
 */
async function fetchBillingStatus(): Promise<any[]> {
  try {
    // In production, would call Stripe API
    // For now, return mock data
    return [
      {
        payment_intent_id: 'pi_abc123',
        status: 'succeeded',
        amount: 200,
        created_at: new Date(Date.now() - 30000).toISOString(),
      },
      {
        payment_intent_id: 'pi_def456',
        status: 'succeeded',
        amount: 150,
        created_at: new Date(Date.now() - 240000).toISOString(),
      },
    ];
  } catch (error) {
    console.error('Failed to fetch billing status:', error);
    return [];
  }
}
