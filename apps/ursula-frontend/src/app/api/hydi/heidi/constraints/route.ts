import { NextRequest, NextResponse } from 'next/server';
import { IntentSandbox } from '@/lib/intent-sandbox';
import { LearningFilter } from '@/lib/learning-filter';

// PUT /api/hydi/heidi/constraints - Update Heidi constraints
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const { sandbox_constraints, learning_constraints } = await request.json();
    
    const intentSandbox = IntentSandbox.getInstance();
    const learningFilter = LearningFilter.getInstance();
    
    // Update constraints
    if (sandbox_constraints) {
      intentSandbox.updateConstraints(sandbox_constraints);
    }
    
    if (learning_constraints) {
      learningFilter.updateConstraints(learning_constraints);
    }
    
    return NextResponse.json({
      message: 'Constraints updated',
      sandbox_constraints: intentSandbox.getConstraints(),
      learning_constraints: learningFilter.getConstraints(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[HEIDI] Error updating constraints:', error);
    return NextResponse.json({ 
      error: 'Failed to update constraints' 
    }, { status: 500 });
  }
}
