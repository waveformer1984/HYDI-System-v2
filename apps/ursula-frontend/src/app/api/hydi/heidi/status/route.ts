import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { HeidiStatusTracker } from '@/lib/heidi-status';
import { IntentSandbox } from '@/lib/intent-sandbox';
import { LearningFilter } from '@/lib/learning-filter';

// GET /api/hydi/heidi/status - Get Heidi status and capabilities
export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId =
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID();
  try {
    const heidiStatus = HeidiStatusTracker.getInstance();
    const intentSandbox = IntentSandbox.getInstance();
    const learningFilter = LearningFilter.getInstance();
    
    const status = heidiStatus.getStatus();
    const canPropose = heidiStatus.canProposeIntent();
    const strategyPerf = heidiStatus.getStrategyRecommendations();
    const failurePatterns = heidiStatus.getFailurePatterns();
    const sandboxStats = intentSandbox.getStatistics();
    const learningStats = learningFilter.getStatistics();
    
    return NextResponse.json({
      heidi_status: status,
      can_propose_intent: canPropose,
      strategy_performance: strategyPerf,
      failure_patterns: failurePatterns,
      sandbox_statistics: sandboxStats,
      learning_statistics: learningStats,
      health_summary: heidiStatus.getHealthSummary(),
      timestamp: new Date().toISOString(),
      traceId,
    }, { headers: { 'x-trace-id': traceId } });

  } catch (error) {
    console.error('[HEIDI] Error getting status:', error);
    return NextResponse.json({
      error: 'Failed to get Heidi status',
      traceId,
    }, { status: 500, headers: { 'x-trace-id': traceId } });
  }
}
