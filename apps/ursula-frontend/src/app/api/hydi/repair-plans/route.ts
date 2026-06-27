import { NextRequest, NextResponse } from 'next/server';
import { RepairPlanManager, RepairStrategyRegistry } from '@/lib/repair-plans';

// POST /api/hydi/repair-plans - Create structured repair plan
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { root_task_id, error, failure_type } = await request.json();

    if (!root_task_id || !error) {
      return NextResponse.json({ 
        error: 'root_task_id and error are required' 
      }, { status: 400 });
    }

    // Create structured repair plan
    const repairPlan = RepairPlanManager.createRepairPlan(root_task_id, error, failure_type);

    // Validate repair plan
    const validation = RepairPlanManager.validateRepairPlan(repairPlan);
    if (!validation.valid) {
      return NextResponse.json({ 
        error: 'Invalid repair plan',
        violations: validation.errors 
      }, { status: 400 });
    }

    console.log(`[REPAIR-PLAN] Created repair plan ${repairPlan.repair_id} for ${root_task_id}`);

    return NextResponse.json({
      repair_plan: repairPlan,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[REPAIR-PLAN] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to create repair plan' 
    }, { status: 500 });
  }
}

// GET /api/hydi/repair-plans - List all repair strategies
export async function GET(): Promise<NextResponse> {
  try {
    const strategies = RepairStrategyRegistry.getAllStrategies();
    
    return NextResponse.json({
      strategies: strategies,
      count: strategies.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[REPAIR-PLAN] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to list repair strategies' 
    }, { status: 500 });
  }
}
