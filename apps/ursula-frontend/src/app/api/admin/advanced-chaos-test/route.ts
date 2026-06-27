import { NextRequest, NextResponse } from 'next/server';
import { AdvancedChaosTesting } from '@/lib/advanced-chaos-testing';

// POST /api/admin/advanced-chaos-test - Run unfair chaos testing
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    console.log('[ADVANCED-CHAOS] Starting unfair chaos testing suite');
    
    const testing = new AdvancedChaosTesting();
    const results = await testing.runAdvancedTests();
    
    const summary = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      averageFailureRate: results.reduce((sum, r) => sum + r.chaosMetrics.failureRate, 0) / results.length,
      dataCorruptionDetected: results.some(r => r.chaosMetrics.dataCorruption),
      infiniteLoopsDetected: results.some(r => r.chaosMetrics.infiniteLoopDetected),
      tests: results,
    };

    console.log(`[ADVANCED-CHAOS] Results: ${summary.passed}/${summary.total} passed`);
    
    if (summary.dataCorruptionDetected) {
      console.error('[ADVANCED-CHAOS] CRITICAL: Data corruption detected in chaos tests');
    }
    
    if (summary.infiniteLoopsDetected) {
      console.error('[ADVANCED-CHAOS] CRITICAL: Infinite loops detected in chaos tests');
    }

    return NextResponse.json({
      success: true,
      summary,
      timestamp: new Date().toISOString(),
      readiness: {
        readyForProduction: summary.failed === 0 && !summary.dataCorruptionDetected && !summary.infiniteLoopsDetected,
        concerns: [
          ...(summary.failed > 0 ? [`${summary.failed} tests failed`] : []),
          ...(summary.dataCorruptionDetected ? ['Data corruption detected'] : []),
          ...(summary.infiniteLoopsDetected ? ['Infinite loops detected'] : []),
        ],
      },
    });

  } catch (error) {
    console.error('[ADVANCED-CHAOS] Advanced chaos testing failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Advanced chaos testing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
