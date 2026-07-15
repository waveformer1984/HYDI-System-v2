import { NextRequest, NextResponse } from 'next/server';
import { RevenueTrigger, REVENUE_TRIGGERS } from '@/lib/ucmrs/types-ral';
import { Component } from '@/lib/ucmrs/types';
import { ProductCandidate } from '@/lib/ucmrs/types-ral';

// Mock database - replace with actual DB connection
let triggers: RevenueTrigger[] = [];
let nextId = 1;

// GET /api/ucmrs/ral/triggers - Get active revenue triggers
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const urgency = searchParams.get('urgency');

  let filteredTriggers = triggers;

  if (status) {
    filteredTriggers = filteredTriggers.filter(t => t.status === status);
  }

  if (urgency) {
    filteredTriggers = filteredTriggers.filter(t => t.urgency === urgency);
  }

  // Sort by urgency and creation date
  const urgencyOrder = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
  filteredTriggers.sort((a, b) => {
    const urgencyDiff = urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    return new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime();
  });

  return NextResponse.json({ triggers: filteredTriggers });
}

// POST /api/ucmrs/ral/triggers/evaluate - Run automatic revenue trigger evaluation
export async function POST_EVALUATE(request: NextRequest) {
  try {
    // Mock data - replace with actual component/product queries
    const mockComponents: Component[] = [
      {
        id: '1',
        component_id: 'LASER_HARP_01',
        ursula_status: 'Controlled',
        validation_status: 'System Verified'
      } as Component,
      {
        id: '2',
        component_id: 'MOTION_SENSOR_01',
        ursula_status: 'Streaming Data',
        validation_status: 'Bench Verified'
      } as Component
    ];

    const mockProducts: ProductCandidate[] = [
      {
        id: '1',
        product_id: 'LASER_HARP_PROD',
        status: 'Demo Ready',
        // ... other fields
      } as ProductCandidate
    ];

    const newTriggers: RevenueTrigger[] = [];

    // Evaluate all trigger conditions
    for (const triggerRule of REVENUE_TRIGGERS) {
      if (triggerRule.check(mockComponents, mockProducts)) {
        // Check if trigger already exists
        const existingTrigger = triggers.find(t =>
          t.trigger_type === triggerRule.trigger_type &&
          t.status === 'Pending'
        );

        if (!existingTrigger) {
          const newTrigger: RevenueTrigger = {
            id: (nextId++).toString(),
            trigger_type: triggerRule.trigger_type,
            condition_met: true,
            triggered_at: new Date().toISOString(),
            status: 'Pending',
            requirements: triggerRule.requirements,
            next_action: triggerRule.next_action,
            urgency: triggerRule.urgency
          };

          newTriggers.push(newTrigger);
          triggers.push(newTrigger);
        }
      }
    }

    // Generate prescriptive summary
    const summary = generateTriggerSummary(newTriggers);

    return NextResponse.json({
      triggers_generated: newTriggers.length,
      triggers: newTriggers,
      summary,
      message: newTriggers.length > 0 ?
        `${newTriggers.length} revenue triggers activated. Stop being polite and start making demands.` :
        'No new triggers. Keep building.'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Trigger evaluation failed' },
      { status: 500 }
    );
  }
}

// PUT /api/ucmrs/ral/triggers/[id]/resolve - Mark trigger as resolved
export async function PUT_RESOLVE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { resolution_notes } = body;

    const triggerIndex = triggers.findIndex(t => t.id === params.id);

    if (triggerIndex === -1) {
      return NextResponse.json({ error: 'Trigger not found' }, { status: 404 });
    }

    const trigger = triggers[triggerIndex];

    // Mark as resolved
    trigger.status = 'Completed';
    trigger.resolved_at = new Date().toISOString();

    // Generate next triggers based on resolution
    const nextTriggers = generateFollowUpTriggers(trigger);

    return NextResponse.json({
      trigger,
      next_triggers: nextTriggers,
      message: `Trigger ${trigger.trigger_type} resolved. ${nextTriggers.length} follow-up triggers created.`
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/ral/triggers/dashboard - Revenue trigger dashboard
export async function GET_DASHBOARD(request: NextRequest) {
  const pendingTriggers = triggers.filter(t => t.status === 'Pending');
  const criticalTriggers = pendingTriggers.filter(t => t.urgency === 'Critical');
  const highTriggers = pendingTriggers.filter(t => t.urgency === 'High');

  const dashboard = {
    total_pending: pendingTriggers.length,
    critical_issues: criticalTriggers.length,
    high_priority: highTriggers.length,

    brutal_assessment: {
      system_health: criticalTriggers.length === 0 ? 'Revenue Ready' : 'Critical Blockers',
      urgency_level: criticalTriggers.length > 0 ? 'IMMEDIATE ACTION REQUIRED' : 'Normal Progress',
      revenue_pipeline: pendingTriggers.length > 5 ? 'Blocked' : 'Flowing'
    },

    immediate_actions: [
      criticalTriggers.length > 0 && `Resolve ${criticalTriggers.length} critical triggers NOW`,
      highTriggers.length > 0 && `Address ${highTriggers.length} high-priority items this week`,
      pendingTriggers.length === 0 && 'Evaluate system for new opportunities'
    ].filter(Boolean),

    trigger_breakdown: {
      'BUILD_DEMO': pendingTriggers.filter(t => t.trigger_type === 'BUILD_DEMO').length,
      'ASSIGN_PRICE': pendingTriggers.filter(t => t.trigger_type === 'ASSIGN_PRICE').length,
      'GENERATE_OFFER_PAGE': pendingTriggers.filter(t => t.trigger_type === 'GENERATE_OFFER_PAGE').length,
      'TEST_SALE': pendingTriggers.filter(t => t.trigger_type === 'TEST_SALE').length
    },

    revenue_readiness: {
      demo_ready: pendingTriggers.filter(t => t.trigger_type === 'BUILD_DEMO').length === 0,
      priced: pendingTriggers.filter(t => t.trigger_type === 'ASSIGN_PRICE').length === 0,
      buyable: pendingTriggers.filter(t => t.trigger_type === 'GENERATE_OFFER_PAGE').length === 0,
      tested: pendingTriggers.filter(t => t.trigger_type === 'TEST_SALE').length === 0
    },

    next_review: criticalTriggers.length > 0 ? 'Immediate' : 'Weekly'
  };

  return NextResponse.json(dashboard);
}

// GET /api/ucmrs/ral/triggers/prescriptive - Get prescriptive revenue actions
export async function GET_PRESCRIPTIVE(request: NextRequest) {
  const pendingTriggers = triggers.filter(t => t.status === 'Pending');

  const prescriptive = {
    this_week: generateWeeklyPrescription(pendingTriggers),
    today: generateDailyPrescription(pendingTriggers),
    now: generateImmediatePrescription(pendingTriggers),

    brutal_truth: {
      revenue_generating: pendingTriggers.filter(t => t.trigger_type === 'TEST_SALE').length === 0,
      demo_built: pendingTriggers.filter(t => t.trigger_type === 'BUILD_DEMO').length === 0,
      actually_for_sale: pendingTriggers.filter(t => t.trigger_type === 'GENERATE_OFFER_PAGE').length === 0,
      assessment: generateBrutalAssessment(pendingTriggers)
    },

    consequence_timeline: {
      '24 hours': 'Critical triggers must be resolved',
      '3 days': 'High-priority triggers block revenue',
      '1 week': 'Medium triggers become urgent',
      '2 weeks': 'System becomes unprofitable'
    }
  };

  return NextResponse.json(prescriptive);
}

// POST /api/ucmrs/ral/triggers/force - Force trigger creation (manual override)
export async function POST_FORCE(request: NextRequest) {
  try {
    const body = await request.json();
    const { trigger_type, component_id, product_id, urgency, notes } = body;

    if (!trigger_type) {
      return NextResponse.json(
        { error: 'Missing required field: trigger_type' },
        { status: 400 }
      );
    }

    const validTypes = ['BUILD_DEMO', 'ASSIGN_PRICE', 'GENERATE_OFFER_PAGE', 'TEST_SALE'];
    if (!validTypes.includes(trigger_type)) {
      return NextResponse.json(
        { error: `Invalid trigger_type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const triggerRule = REVENUE_TRIGGERS.find(t => t.trigger_type === trigger_type);
    if (!triggerRule) {
      return NextResponse.json(
        { error: 'Trigger type not found in rules' },
        { status: 400 }
      );
    }

    const newTrigger: RevenueTrigger = {
      id: (nextId++).toString(),
      trigger_type: trigger_type as 'BUILD_DEMO' | 'ASSIGN_PRICE' | 'GENERATE_OFFER_PAGE' | 'TEST_SALE',
      component_id,
      product_id,
      condition_met: true,
      triggered_at: new Date().toISOString(),
      status: 'Pending',
      requirements: triggerRule.requirements,
      next_action: triggerRule.next_action,
      urgency: urgency || 'Medium'
    };

    triggers.push(newTrigger);

    return NextResponse.json({
      trigger: newTrigger,
      message: `Manual trigger ${trigger_type} created. Execute immediately.`
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// Helper functions

function generateTriggerSummary(newTriggers: RevenueTrigger[]) {
  const critical = newTriggers.filter(t => t.urgency === 'Critical').length;
  const high = newTriggers.filter(t => t.urgency === 'High').length;

  return {
    total: newTriggers.length,
    critical,
    high,
    medium: newTriggers.filter(t => t.urgency === 'Medium').length,
    low: newTriggers.filter(t => t.urgency === 'Low').length,
    urgency_level: critical > 0 ? 'CRITICAL' : high > 0 ? 'HIGH' : 'NORMAL',
    immediate_action_required: critical + high
  };
}

function generateFollowUpTriggers(resolvedTrigger: RevenueTrigger): RevenueTrigger[] {
  const followUps: RevenueTrigger[] = [];

  // Define trigger progression
  const progression: Record<string, string[]> = {
    'BUILD_DEMO': ['ASSIGN_PRICE'],
    'ASSIGN_PRICE': ['GENERATE_OFFER_PAGE'],
    'GENERATE_OFFER_PAGE': ['TEST_SALE'],
    'TEST_SALE': [] // End of pipeline
  };

  const nextTypes = progression[resolvedTrigger.trigger_type] || [];

  nextTypes.forEach(nextType => {
    const nextRule = REVENUE_TRIGGERS.find(t => t.trigger_type === nextType);
    if (nextRule) {
      const followUp: RevenueTrigger = {
        id: (nextId++).toString(),
        trigger_type: nextType as RevenueTrigger['trigger_type'],
        condition_met: true,
        triggered_at: new Date().toISOString(),
        status: 'Pending',
        requirements: nextRule.requirements,
        next_action: nextRule.next_action,
        urgency: 'High' // Follow-ups are high priority
      };

      followUps.push(followUp);
      triggers.push(followUp);
    }
  });

  return followUps;
}

function generateWeeklyPrescription(pendingTriggers: RevenueTrigger[]): string[] {
  const prescriptions = [];

  const critical = pendingTriggers.filter(t => t.urgency === 'Critical');
  const high = pendingTriggers.filter(t => t.urgency === 'High');

  if (critical.length > 0) {
    prescriptions.push(`Resolve ${critical.length} critical triggers immediately`);
  }

  if (high.length > 0) {
    prescriptions.push(`Complete ${high.length} high-priority tasks`);
  }

  const buildDemo = pendingTriggers.filter(t => t.trigger_type === 'BUILD_DEMO');
  if (buildDemo.length > 0) {
    prescriptions.push(`Build ${buildDemo.length} demos this week`);
  }

  const testSales = pendingTriggers.filter(t => t.trigger_type === 'TEST_SALE');
  if (testSales.length > 0) {
    prescriptions.push(`Attempt sales for ${testSales.length} products`);
  }

  return prescriptions.length > 0 ? prescriptions : ['Focus on advancing components to Level 3+'];
}

function generateDailyPrescription(pendingTriggers: RevenueTrigger[]): string[] {
  const critical = pendingTriggers.filter(t => t.urgency === 'Critical');

  if (critical.length > 0) {
    return critical.map(t => `CRITICAL: ${t.next_action}`);
  }

  const high = pendingTriggers.filter(t => t.urgency === 'High').slice(0, 3);
  return high.map(t => `HIGH: ${t.next_action}`);
}

function generateImmediatePrescription(pendingTriggers: RevenueTrigger[]): string[] {
  const critical = pendingTriggers.filter(t => t.urgency === 'Critical');

  if (critical.length > 0) {
    return critical.slice(0, 1).map(t => `RIGHT NOW: ${t.next_action}`);
  }

  return ['Continue current work, check triggers hourly'];
}

function generateBrutalAssessment(pendingTriggers: RevenueTrigger[]): string {
  const critical = pendingTriggers.filter(t => t.urgency === 'Critical').length;
  const testSales = pendingTriggers.filter(t => t.trigger_type === 'TEST_SALE').length;

  if (critical > 0) {
    return 'SYSTEM BLOCKED - Fix critical issues or no revenue';
  }

  if (testSales === 0) {
    return 'NO REVENUE ACTIVITY - Building but not selling';
  }

  if (pendingTriggers.length > 10) {
    return 'TOO MANY BOTTLENECKS - Focus or fail';
  }

  return 'Revenue pipeline flowing - maintain momentum';
}
