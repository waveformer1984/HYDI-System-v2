import { NextRequest, NextResponse } from 'next/server';
import { IntentSandbox } from '@/lib/intent-sandbox';
import { runHeidiLoop, IntentInput } from '@/lib/heidi-loop-engine';

// POST /api/hydi/heidi/simulate - Simulate intent execution
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { intent_id, description, strategy, heidi_confidence } = await request.json();

    // Accept either intent_id or just the intent fields
    if (!description || !strategy) {
      return NextResponse.json({
        error: 'Description and strategy are required'
      }, { status: 400 });
    }

    const intentSandbox = IntentSandbox.getInstance();

    // Create intent input for centralized engine
    const intentInput: IntentInput = {
      description,
      strategy,
      heidi_confidence: heidi_confidence || 0.5,
      cpu_required: 0.5,
      time_required: 1000,
      risk_level: "MEDIUM",
      complexity: "MEDIUM"
    };

    // Use centralized loop engine - NO LOGIC IN ROUTES
    const result = runHeidiLoop(intentInput);

    return NextResponse.json({
      intent_id,
      simulation: result.simulation,
      recommendation: result.allowed ? "APPROVE" : "REJECT",
      decision_reason: result.decision_reason,
      timestamp: result.timestamp
    });

  } catch (error) {
    console.error('[HEIDI] Error simulating intent:', error);
    return NextResponse.json({
      error: 'Failed to simulate intent'
    }, { status: 500 });
  }
}
