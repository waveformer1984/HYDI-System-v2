import { NextRequest, NextResponse } from 'next/server';
import { HeidiStatusTracker } from '@/lib/heidi-status';
import { IntentSandbox } from '@/lib/intent-sandbox';
import { runHeidiLoop, IntentInput } from '@/lib/heidi-loop-engine';

// POST /api/hydi/heidi/intent - Propose intent for validation
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { description, strategy, heidi_confidence } = await request.json();

    if (!description || !strategy) {
      return NextResponse.json({
        error: 'Description and strategy are required'
      }, { status: 400 });
    }

    const heidiStatus = HeidiStatusTracker.getInstance();
    const intentSandbox = IntentSandbox.getInstance();

    // Check if Heidi can propose
    const canPropose = heidiStatus.canProposeIntent();
    if (!canPropose.allowed) {
      return NextResponse.json({
        allowed: false,
        reason: canPropose.reason,
        heidi_blocked: true
      }, { status: 200 });
    }

    // Create intent input for centralized engine
    const intentInput: IntentInput = {
      description,
      strategy,
      heidi_confidence: heidi_confidence || 0.5,
      cpu_required: 0.5, // Default - would be calculated from content
      time_required: 1000, // Default - would be calculated from content
      risk_level: "MEDIUM", // Default - would be calculated from content
      complexity: "MEDIUM" // Default - would be calculated from content
    };

    // Use centralized loop engine - NO LOGIC IN ROUTES
    const result = await runHeidiLoop(intentInput);

    return NextResponse.json({
      intent_id: `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      allowed: result.allowed,
      simulation: result.simulation,
      decision_reason: result.decision_reason,
      heidi_status: heidiStatus.getStatus(),
      timestamp: result.timestamp
    });

  } catch (error) {
    console.error('[HEIDI] Error proposing intent:', error);
    return NextResponse.json({
      error: 'Failed to propose intent'
    }, { status: 500 });
  }
}
