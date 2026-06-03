import { NextRequest, NextResponse } from 'next/server';
import { ChaosTesting } from '@/lib/chaos-testing';

// POST /api/admin/chaos-test - Run chaos testing suite
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    console.log('[CHAOS-TEST] Starting chaos testing suite');
    
    const testing = new ChaosTesting();
    const results = await testing.runAllTests();
    
    const summary = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      tests: results,
    };

    console.log(`[CHAOS-TEST] Results: ${summary.passed}/${summary.total} passed`);

    return NextResponse.json({
      success: true,
      summary,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[CHAOS-TEST] Chaos testing failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Chaos testing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
