import { NextRequest, NextResponse } from 'next/server';
import { MonetizationSprint, CreateSprintRequest, SPRINT_TEMPLATE } from '@/lib/ucmrs/types-ral';
import { ProductCandidate } from '@/lib/ucmrs/types-ral';

// Mock database - replace with actual DB connection
const sprints: MonetizationSprint[] = [];
let nextId = 1;
let nextSprintNumber = 1;

// GET /api/ucmrs/ral/sprint - List monetization sprints
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const active = searchParams.get('active');

  let filteredSprints = sprints;

  if (status) {
    filteredSprints = filteredSprints.filter(s => s.status === status);
  }

  if (active === 'true') {
    filteredSprints = filteredSprints.filter(s => s.status === 'Active');
  }

  // Sort by sprint number (most recent first)
  filteredSprints.sort((a, b) => b.sprint_number - a.sprint_number);

  return NextResponse.json({ sprints: filteredSprints });
}

// POST /api/ucmrs/ral/sprint - Create new 30-day monetization sprint
export async function POST(request: NextRequest) {
  try {
    const body: CreateSprintRequest = await request.json();

    if (!body.target_product_id || !body.target_revenue) {
      return NextResponse.json(
        { error: 'Missing required fields: target_product_id, target_revenue' },
        { status: 400 }
      );
    }

    // Check if there's already an active sprint
    const activeSprint = sprints.find(s => s.status === 'Active');
    if (activeSprint) {
      return NextResponse.json(
        { error: 'Active sprint already exists. Complete current sprint before starting new one.' },
        { status: 409 }
      );
    }

    // Validate target product exists (mock check)
    const mockProducts: ProductCandidate[] = [
      {
        id: '1',
        product_id: 'LASER_HARP_PROD',
        status: 'Demo Ready',
        // ... other fields
      } as ProductCandidate
    ];

    const targetProduct = mockProducts.find(p => p.product_id === body.target_product_id);
    if (!targetProduct) {
      return NextResponse.json(
        { error: 'Target product not found' },
        { status: 404 }
      );
    }

    // Calculate sprint dates
    const startDate = body.start_date ? new Date(body.start_date) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    const newSprint: MonetizationSprint = {
      id: (nextId++).toString(),
      sprint_number: nextSprintNumber++,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      status: 'Planning',
      ...SPRINT_TEMPLATE,
      target_product_id: body.target_product_id,
      target_revenue: body.target_revenue,
      actual_revenue: 0,
      sales_attempted: 0,
      sales_completed: 0,
      lessons_learned: [],
      next_steps: []
    };

    sprints.push(newSprint);

    return NextResponse.json({
      sprint: newSprint,
      message: '30-day monetization sprint created. Start Week 1 immediately.',
      immediate_action: 'Identify module components and build demo',
      deadline: '30 days from today'
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/ral/sprint/[id]/start - Start sprint execution
export async function PUT_START(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sprintIndex = sprints.findIndex(s => s.id === params.id);

    if (sprintIndex === -1) {
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
    }

    const sprint = sprints[sprintIndex];
    
    if (sprint.status !== 'Planning') {
      return NextResponse.json(
        { error: 'Only planning sprints can be started' },
        { status: 400 }
      );
    }

    sprint.status = 'Active';

    return NextResponse.json({
      sprint,
      message: 'Sprint started. Week 1 focus: Identify module with highest Level 3 density, force into product definition, build demo.',
      week_focus: sprint.week_1_focus,
      deadline: sprint.end_date
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to start sprint' },
      { status: 500 }
    );
  }
}

// PUT /api/ucmrs/ral/sprint/[id]/complete - Complete sprint and evaluate results
export async function PUT_COMPLETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { lessons_learned, next_steps } = body;

    const sprintIndex = sprints.findIndex(s => s.id === params.id);

    if (sprintIndex === -1) {
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
    }

    const sprint = sprints[sprintIndex];
    
    if (sprint.status !== 'Active') {
      return NextResponse.json(
        { error: 'Only active sprints can be completed' },
        { status: 400 }
      );
    }

    // Determine success/failure
    const success = sprint.actual_revenue >= sprint.target_revenue;
    const status = success ? 'Completed' : 'Failed';

    sprint.status = status;
    sprint.lessons_learned = lessons_learned || [];
    sprint.next_steps = next_steps || [];

    return NextResponse.json({
      sprint,
      success,
      evaluation: generateSprintEvaluation(sprint),
      message: `Sprint ${status === 'Completed' ? 'completed successfully' : 'failed'}. ${success ? 'Scale approach.' : 'Pivot strategy.'}`
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/ral/sprint/[id]/progress - Update sprint progress
export async function PUT_PROGRESS(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { actual_revenue, sales_attempted, sales_completed, week_focus } = body;

    const sprintIndex = sprints.findIndex(s => s.id === params.id);

    if (sprintIndex === -1) {
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
    }

    const sprint = sprints[sprintIndex];

    if (sprint.status !== 'Active') {
      return NextResponse.json(
        { error: 'Only active sprints can be updated' },
        { status: 400 }
      );
    }

    // Update progress
    if (actual_revenue !== undefined) sprint.actual_revenue = actual_revenue;
    if (sales_attempted !== undefined) sprint.sales_attempted = sales_attempted;
    if (sales_completed !== undefined) sprint.sales_completed = sales_completed;

    // Calculate current week based on dates
    const now = new Date();
    const start = new Date(sprint.start_date);
    const weekNumber = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

    const progress = {
      sprint: sprint,
      current_week: Math.min(weekNumber, 4),
      progress_percentage: Math.round((sprint.actual_revenue / sprint.target_revenue) * 100),
      conversion_rate: sales_attempted > 0 ? Math.round((sales_completed / sales_attempted) * 100) : 0,
      on_track: sprint.actual_revenue >= (sprint.target_revenue * (weekNumber / 4)),
      week_focus: week_focus || getCurrentWeekFocus(weekNumber),
      days_remaining: Math.ceil((new Date(sprint.end_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    };

    return NextResponse.json(progress);

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/ral/sprint/[id]/prescriptive - Get prescriptive sprint actions
export async function GET_PRESCRIPTIVE(request: NextRequest, { params }: { params: { id: string } }) {
  const sprint = sprints.find(s => s.id === params.id);

  if (!sprint) {
    return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
  }

  const prescriptive = generateSprintPrescriptive(sprint);

  return NextResponse.json({
    sprint_id: sprint.id,
    sprint_number: sprint.sprint_number,
    status: sprint.status,
    prescriptive: prescriptive,
    brutal_assessment: generateBrutalSprintAssessment(sprint)
  });
}

// GET /api/ucmrs/ral/sprint/active - Get current active sprint
export async function GET_ACTIVE(request: NextRequest) {
  const activeSprint = sprints.find(s => s.status === 'Active');

  if (!activeSprint) {
    return NextResponse.json({
      active_sprint: null,
      message: 'No active sprint. Start a new 30-day monetization sprint.',
      recommendation: 'Select your highest-readiness product and begin sprint'
    });
  }

  const now = new Date();
  const start = new Date(activeSprint.start_date);
  const weekNumber = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return NextResponse.json({
    active_sprint: activeSprint,
    current_week: Math.min(weekNumber, 4),
    week_focus: getCurrentWeekFocus(weekNumber),
    days_remaining: Math.ceil((new Date(activeSprint.end_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    progress_percentage: Math.round((activeSprint.actual_revenue / activeSprint.target_revenue) * 100),
    immediate_action: generateImmediateSprintAction(activeSprint, weekNumber)
  });
}

// GET /api/ucmrs/ral/sprint/dashboard - Sprint dashboard
export async function GET_DASHBOARD(request: NextRequest) {
  const activeSprint = sprints.find(s => s.status === 'Active');
  const completedSprints = sprints.filter(s => s.status === 'Completed');
  const failedSprints = sprints.filter(s => s.status === 'Failed');

  const dashboard = {
    current_sprint: activeSprint ? {
      sprint_number: activeSprint.sprint_number,
      target_revenue: activeSprint.target_revenue,
      actual_revenue: activeSprint.actual_revenue,
      progress_percentage: Math.round((activeSprint.actual_revenue / activeSprint.target_revenue) * 100),
      days_remaining: Math.ceil((new Date(activeSprint.end_date).getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
    } : null,

    sprint_history: {
      total_sprints: sprints.length,
      completed: completedSprints.length,
      failed: failedSprints.length,
      success_rate: sprints.length > 0 ? Math.round((completedSprints.length / sprints.length) * 100) : 0,
      total_revenue_generated: sprints.reduce((sum, s) => sum + s.actual_revenue, 0)
    },

    brutal_metrics: {
      actually_making_money: activeSprint ? activeSprint.actual_revenue > 0 : false,
      on_track_to_goal: activeSprint ? activeSprint.actual_revenue >= (activeSprint.target_revenue * 0.5) : false,
      time_running_out: activeSprint ? 
        Math.ceil((new Date(activeSprint.end_date).getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)) < 7 : 
        false
    },

    immediate_focus: activeSprint ? 
      `Week ${Math.min(Math.floor((new Date().getTime() - new Date(activeSprint.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1, 4)}: ${getCurrentWeekFocus(Math.min(Math.floor((new Date().getTime() - new Date(activeSprint.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1, 4))}` :
      'Start a new sprint to begin monetization',

    next_action: activeSprint ? 
      'Execute current week focus relentlessly' :
      'Create new sprint and select target product'
  };

  return NextResponse.json(dashboard);
}

// Helper functions

function getCurrentWeekFocus(weekNumber: number): string {
  const weekFocuses = [
    'Identify module with highest Level 3 density, force into product definition, build demo',
    'Assign price, create simple landing page, record demo video',
    'Attempt 10 sales (yes, attempt, not "prepare to attempt someday")',
    'Evaluate: Bought? expand. Ignored? reposition. Confusing? simplify'
  ];
  
  return weekFocuses[Math.min(weekNumber - 1, 3)];
}

function generateSprintEvaluation(sprint: MonetizationSprint) {
  const success = sprint.actual_revenue >= sprint.target_revenue;
  const conversionRate = sprint.sales_attempted > 0 ? (sprint.sales_completed / sprint.sales_attempted) * 100 : 0;

  return {
    success,
    revenue_achieved: sprint.actual_revenue,
    revenue_target: sprint.target_revenue,
    conversion_rate: Math.round(conversionRate),
    sales_efficiency: sprint.sales_attempted > 0 ? Math.round(sprint.actual_revenue / sprint.sales_attempted) : 0,
    assessment: success ? 
      'Product validated and revenue-generating' :
      'Product needs repositioning or pivot',
    recommendation: success ? 
      'Scale successful approach immediately' :
      'Analyze failures and test new positioning'
  };
}

function generateSprintPrescriptive(sprint: MonetizationSprint) {
  const now = new Date();
  const start = new Date(sprint.start_date);
  const weekNumber = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const daysRemaining = Math.ceil((new Date(sprint.end_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  return {
    current_week: Math.min(weekNumber, 4),
    week_focus: getCurrentWeekFocus(weekNumber),
    days_remaining: daysRemaining,
    urgency_level: daysRemaining < 7 ? 'Critical' : daysRemaining < 14 ? 'High' : 'Normal',
    
    immediate_actions: [
      `Execute: ${getCurrentWeekFocus(weekNumber)}`,
      `Track: ${Math.round((sprint.actual_revenue / sprint.target_revenue) * 100)}% of target`,
      daysRemaining < 7 && 'URGENT: Accelerate all activities'
    ].filter(Boolean),

    success_probability: calculateSuccessProbability(sprint),
    required_daily_effort: calculateRequiredDailyEffort(sprint, daysRemaining),
    pivot_triggers: generatePivotTriggers(sprint)
  };
}

function generateBrutalSprintAssessment(sprint: MonetizationSprint) {
  const progressPercentage = (sprint.actual_revenue / sprint.target_revenue) * 100;
  const now = new Date();
  const daysRemaining = Math.ceil((new Date(sprint.end_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (progressPercentage === 0 && daysRemaining < 15) {
    return 'Failing badly. Either pivot dramatically or kill product.';
  }

  if (progressPercentage < 25 && daysRemaining < 10) {
    return 'Not working. Current approach is wrong. Fix it now.';
  }

  if (progressPercentage >= 75) {
    return 'Working. Scale aggressively and don\'t get distracted.';
  }

  if (progressPercentage >= 50) {
    return 'Progress being made. Maintain focus and optimize.';
  }

  return 'Too early to tell. Keep executing and measure carefully.';
}

function calculateSuccessProbability(sprint: MonetizationSprint): number {
  const progressPercentage = (sprint.actual_revenue / sprint.target_revenue) * 100;
  const now = new Date();
  const daysElapsed = Math.floor((now.getTime() - new Date(sprint.start_date).getTime()) / (24 * 60 * 60 * 1000));
  const daysTotal = 30;
  const timeProgress = daysElapsed / daysTotal;

  if (progressPercentage >= timeProgress * 100) {
    return Math.min(95, Math.round(progressPercentage));
  }

  return Math.max(5, Math.round(progressPercentage * 0.7));
}

function calculateRequiredDailyEffort(sprint: MonetizationSprint, daysRemaining: number): string {
  const revenueNeeded = sprint.target_revenue - sprint.actual_revenue;
  
  if (daysRemaining <= 0) {
    return 'Sprint ended - evaluate results';
  }

  const dailyRevenueTarget = revenueNeeded / daysRemaining;

  if (dailyRevenueTarget > 500) {
    return 'Aggressive sales effort required';
  }

  if (dailyRevenueTarget > 200) {
    return 'High-intensity sales activity';
  }

  if (dailyRevenueTarget > 50) {
    return 'Consistent daily sales effort';
  }

  return 'Maintain current pace';
}

function generatePivotTriggers(sprint: MonetizationSprint): string[] {
  const triggers = [];
  
  if (sprint.sales_attempted > 20 && sprint.sales_completed === 0) {
    triggers.push('No sales after 20 attempts - reposition product');
  }

  if (sprint.sales_attempted > 0) {
    const conversionRate = (sprint.sales_completed / sprint.sales_attempted) * 100;
    if (conversionRate < 5) {
      triggers.push('Conversion rate below 5% - fix messaging or pricing');
    }
  }

  const now = new Date();
  const daysRemaining = Math.ceil((new Date(sprint.end_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (daysRemaining < 7 && sprint.actual_revenue < sprint.target_revenue * 0.3) {
    triggers.push('Less than 30% target with <7 days - consider pivot');
  }

  return triggers.length > 0 ? triggers : ['Continue current approach'];
}

function generateImmediateSprintAction(sprint: MonetizationSprint, weekNumber: number): string {
  const focus = getCurrentWeekFocus(weekNumber);
  
  if (weekNumber === 1 && sprint.actual_revenue === 0) {
    return `URGENT: ${focus} - No revenue yet`;
  }

  if (weekNumber === 3 && sprint.sales_attempted < 5) {
    return `CRITICAL: ${focus} - Sales attempts too low`;
  }

  return focus;
}
