import { NextRequest, NextResponse } from 'next/server';
import { HeidiStatusTracker } from '@/lib/heidi-status';
import { LearningFilter } from '@/lib/learning-filter';
import { learnFromFailure } from '@/lib/heidi-loop-engine';

// POST /api/hydi/heidi/learn - Process learning signals
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { signals } = await request.json();

    if (!Array.isArray(signals)) {
      return NextResponse.json({
        error: 'Signals must be an array'
      }, { status: 400 });
    }

    const learningFilter = LearningFilter.getInstance();

    // Process learning signals - NO LOGIC IN ROUTES
    const result = await learningFilter.processLearning(signals);

    // Process failures with centralized engine
    for (const signal of signals) {
      if (signal.signal_type === "failure" && signal.failure_signature) {
        const failureType = mapSignatureToFailureType(signal.failure_signature);
        learnFromFailure({
          type: failureType,
          intent_id: signal.intent_id || "unknown",
          severity: signal.signal_strength,
          context: signal
        });
      }
    }

    return NextResponse.json({
      learning_result: result,
      heidi_status: HeidiStatusTracker.getInstance().getStatus(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[HEIDI] Error processing learning:', error);
    return NextResponse.json({
      error: 'Failed to process learning'
    }, { status: 500 });
  }
}

function mapSignatureToFailureType(signature: string): "timeout" | "overload" | "resource_limit" | "security_violation" | "policy_breach" {
  if (signature.includes("timeout")) return "timeout";
  if (signature.includes("overload") || signature.includes("cpu")) return "overload";
  if (signature.includes("resource")) return "resource_limit";
  if (signature.includes("security")) return "security_violation";
  if (signature.includes("policy")) return "policy_breach";
  return "resource_limit"; // default
}
