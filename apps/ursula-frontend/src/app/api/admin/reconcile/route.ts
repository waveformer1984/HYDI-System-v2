import { NextRequest, NextResponse } from 'next/server';
import { FinancialReconciliation } from '@/lib/financial-reconciliation';

// POST /api/admin/reconcile - Run financial reconciliation
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { taskIds } = body;
    
    console.log('[RECONCILE] Starting financial reconciliation');

    const reconciliation = new FinancialReconciliation();
    
    let reports;
    if (taskIds && Array.isArray(taskIds)) {
      reports = await reconciliation.reconcileTasks(taskIds);
    } else {
      // Reconcile recent tasks (would be implemented in production)
      reports = await reconciliation.reconcileTasks([]);
    }

    const summary = reconciliation.getReconciliationSummary(reports);

    console.log(`[RECONCILE] Results: ${summary.correct}/${summary.total} correct, ${summary.errorCount} errors`);

    return NextResponse.json({
      success: true,
      summary,
      reports,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[RECONCILE] Reconciliation failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Reconciliation failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
