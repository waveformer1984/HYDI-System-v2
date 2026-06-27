import { NextRequest, NextResponse } from 'next/server';
import { ReconciliationService } from '@/lib/reconciliation-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { hoursBack = 24 } = body;

    const reconciliationService = new ReconciliationService();
    const result = await reconciliationService.triggerManualReconciliation(hoursBack);

    console.log(`[RECONCILIATION] Manual reconciliation completed: ${result.discrepancy.percentage.toFixed(2)}% discrepancy`);

    return NextResponse.json({
      success: true,
      result: {
        period: result.period,
        discrepancy: result.discrepancy,
        alerts: result.alerts,
        recommendations: result.recommendations,
        summary: {
          ledgerDebits: result.ledger.totalDebits,
          stripeRevenue: result.stripe.totalRevenue,
          transactionCount: {
            ledger: result.ledger.transactions.length,
            stripe: result.stripe.transactions.length
          }
        }
      }
    });
  } catch (error) {
    console.error('[RECONCILIATION] Manual reconciliation failed:', error);
    return NextResponse.json(
      { error: 'Reconciliation failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const reconciliationService = new ReconciliationService();
    const health = await reconciliationService.healthCheck();

    return NextResponse.json({
      status: 'reconciliation_service',
      health: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[RECONCILIATION] Health check failed:', error);
    return NextResponse.json(
      { error: 'Health check failed', message: (error as Error).message },
      { status: 500 }
    );
  }
}
