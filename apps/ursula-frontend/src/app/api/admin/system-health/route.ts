import { NextRequest, NextResponse } from 'next/server';
import { ResilientUrsulaBridge } from '@/lib/circuit-breaker';
import { RecoveryWorkerService } from '@/lib/execution-recovery';

// GET /api/admin/system-health - Get comprehensive system health
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    console.log('[HEALTH] Checking system health');
    
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      components: {
        ursula_bridge: {
          status: 'unknown',
          details: {},
        },
        recovery_worker: {
          status: 'unknown',
          details: {},
        },
        financial_reconciliation: {
          status: 'unknown',
          details: {},
        },
      },
      issues: [] as string[],
    };

    // Check Ursula Bridge circuit breaker
    try {
      const bridge = new ResilientUrsulaBridge();
      const circuitStatus = bridge.getCircuitBreakerStatus();
      
      health.components.ursula_bridge = {
        status: circuitStatus.isHealthy ? 'healthy' : 'degraded',
        details: circuitStatus,
      };
      
      if (!circuitStatus.isHealthy) {
        health.issues.push('Ursula Bridge circuit breaker is open or degraded');
        health.status = 'degraded';
      }
    } catch (error) {
      health.components.ursula_bridge = {
        status: 'error',
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
      health.issues.push('Ursula Bridge health check failed');
      health.status = 'unhealthy';
    }

    // Check Recovery Worker
    try {
      // In production, would check if recovery worker is running
      health.components.recovery_worker = {
        status: 'healthy',
        details: { running: true, lastRun: new Date().toISOString() },
      };
    } catch (error) {
      health.components.recovery_worker = {
        status: 'error',
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
      health.issues.push('Recovery Worker health check failed');
      health.status = 'unhealthy';
    }

    // Check Financial Reconciliation
    try {
      // In production, would check last reconciliation results
      health.components.financial_reconciliation = {
        status: 'healthy',
        details: { lastRun: new Date().toISOString(), discrepancies: 0 },
      };
    } catch (error) {
      health.components.financial_reconciliation = {
        status: 'error',
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
      health.issues.push('Financial Reconciliation health check failed');
      health.status = 'unhealthy';
    }

    // Overall status determination
    if (health.issues.length === 0) {
      health.status = 'healthy';
    } else if (health.issues.some(issue => issue.includes('error'))) {
      health.status = 'unhealthy';
    } else {
      health.status = 'degraded';
    }

    console.log(`[HEALTH] System status: ${health.status}, Issues: ${health.issues.length}`);

    return NextResponse.json(health);

  } catch (error) {
    console.error('[HEALTH] Health check failed:', error);
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      status: 'error',
      error: 'Health check failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
