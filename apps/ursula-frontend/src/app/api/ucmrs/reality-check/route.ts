import { NextRequest, NextResponse } from 'next/server';
import { Component } from '@/lib/ucmrs/types';

// GET /api/ucmrs/reality-check - The brutal truth about your components
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get('componentId');
  const moduleId = searchParams.get('moduleId');

  // Mock component data - replace with actual DB query
  const mockComponents: Component[] = [
    {
      id: '1',
      component_id: 'LASER_HARP_01',
      module_name: 'Laser Harp System',
      category: 'Audio',
      physical_status: 'Tested',
      ursula_status: 'Streaming Data',
      monetization_class: 'Core Product',
      revenue_path: 'Direct Sale',
      solves_real_problem: true,
      would_pay_today: true,
      can_demo_60_seconds: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z'
    } as Component,
    {
      id: '2',
      component_id: 'MOTION_SENSOR_01',
      module_name: 'Gesture Control',
      category: 'Sensor',
      physical_status: 'Wired',
      ursula_status: 'Registered',
      monetization_class: 'Feature',
      revenue_path: 'Subscription',
      solves_real_problem: false,
      would_pay_today: false,
      can_demo_60_seconds: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z'
    } as Component
  ];

  let components = mockComponents;

  if (componentId) {
    components = components.filter(c => c.component_id === componentId);
  }

  if (moduleId) {
    components = components.filter(c => c.module_name === moduleId);
  }

  const realityChecks = components.map(component => runRealityCheck(component));

  return NextResponse.json({
    reality_checks: realityChecks,
    summary: generateRealitySummary(realityChecks)
  });
}

// POST /api/ucmrs/reality-check/evaluate - Run reality check on specific component
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component_id, solves_real_problem, would_pay_today, can_demo_60_seconds } = body;

    if (!component_id) {
      return NextResponse.json(
        { error: 'Missing required field: component_id' },
        { status: 400 }
      );
    }

    const realityCheck = {
      component_id,
      brutal_questions: [
        {
          question: 'Does this solve a real problem?',
          answer: solves_real_problem ? 'Yes' : 'No',
          weight: 0.4,
          explanation: solves_real_problem ? 
            'Addresses actual user need' : 
            'Solution looking for a problem'
        },
        {
          question: 'Would someone pay for this TODAY?',
          answer: would_pay_today ? 'Yes' : 'No',
          weight: 0.4,
          explanation: would_pay_today ? 
            'Immediate market demand exists' : 
            'No clear value proposition'
        },
        {
          question: 'Can it be demoed in 60 seconds?',
          answer: can_demo_60_seconds ? 'Yes' : 'No',
          weight: 0.2,
          explanation: can_demo_60_seconds ? 
            'Quick value demonstration possible' : 
            'Too complex for immediate understanding'
        }
      ],
      score: calculateRealityScore(solves_real_problem, would_pay_today, can_demo_60_seconds),
      classification: classifyComponent(solves_real_problem, would_pay_today, can_demo_60_seconds),
      timestamp: new Date().toISOString()
    };

    const recommendations = generateRealityRecommendations(realityCheck);

    return NextResponse.json({
      reality_check: realityCheck,
      recommendations,
      brutal_honesty: getBrutalHonesty(realityCheck)
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/reality-check/dashboard - Overall reality dashboard
export async function GET_DASHBOARD(request: NextRequest) {
  // Mock dashboard data
  const dashboard = {
    overall_health: {
      total_components: 12,
      products: 3,
      rd_projects: 9,
      reality_score: 0.35,
      assessment: 'Mostly R&D with some product potential'
    },
    
    brutal_metrics: {
      solves_real_problems: 4, // 33%
      people_would_pay_today: 2, // 17%
      can_demo_60_seconds: 5, // 42%
      actual_products: 1, // 8%
      time_wasters: 8 // 67%
    },

    reality_distribution: {
      'Product': 1,
      'Potential Product': 2,
      'R&D': 6,
      'Time Waster': 3
    },

    immediate_actions: [
      'Kill 3 time-wasting components immediately',
      'Focus on 1 actual product',
      'Convert 2 potential products or reclassify as R&D',
      'Stop calling R&D projects "products"'
    ],

    financial_impact: {
      current_focus: 'R&D projects with no revenue',
      missed_opportunity: '$0/month in potential revenue',
      recommended_focus: 'Single product execution',
      potential_revenue: '$2,500-8,500/month'
    },

    next_steps: {
      week_1: ['Kill time wasters', 'Focus on single product'],
      month_1: ['Launch first product', 'Generate revenue'],
      quarter_1: ['Scale successful product', 'Evaluate R&D assets']
    }
  };

  return NextResponse.json(dashboard);
}

// GET /api/ucmrs/reality-check/kill-list - Components that should be terminated
export async function GET_KILL_LIST(request: NextRequest) {
  // Mock kill list analysis
  const killList = [
    {
      component_id: 'EXPERIMENTAL_SENSOR_05',
      reason: 'Fails all reality checks',
      time_invested: '3 months',
      remaining_value: 'None',
      recommendation: 'Kill immediately and document learnings',
      emotional_attachment: 'Medium - "cool technology but no purpose"'
    },
    {
      component_id: 'PROTOTYPE_XYZ',
      reason: 'No one would pay for this',
      time_invested: '6 weeks',
      remaining_value: 'Component reuse potential',
      recommendation: 'Extract useful parts, kill the rest',
      emotional_attachment: 'High - "personal favorite project"'
    },
    {
      component_id: 'RESEARCH_PROJECT_ALPHA',
      reason: 'Cannot demo in 60 seconds',
      time_invested: '2 months',
      remaining_value: 'Research insights',
      recommendation: 'Document as research, stop calling it a product',
      emotional_attachment: 'Low - "academic exercise"'
    }
  ];

  return NextResponse.json({
    kill_list: killList,
    total_time_wasted: killList.reduce((total, item) => {
      // Parse time invested and sum up
      const months = parseInt(item.time_invested) || 0;
      return total + months;
    }, 0),
    recommendation: 'Kill these immediately. You\'re wasting time on hobbies.',
    savings_potential: 'Focus time on actual revenue-generating products'
  });
}

// POST /api/ucmrs/reality-check/execute-kill - Execute component termination
export async function POST_EXECUTE_KILL(request: NextRequest) {
  try {
    const body = await request.json();
    const { component_ids, reason, confirmation } = body;

    if (!component_ids || !Array.isArray(component_ids)) {
      return NextResponse.json(
        { error: 'Missing required field: component_ids (array)' },
        { status: 400 }
      );
    }

    if (!confirmation || confirmation !== 'I understand this is permanent') {
      return NextResponse.json(
        { error: 'Must confirm understanding of permanent action' },
        { status: 400 }
      );
    }

    // Mock execution - in reality this would update database, archive components, etc.
    const killedComponents = component_ids.map(id => ({
      component_id: id,
      killed_at: new Date().toISOString(),
      reason: reason || 'Failed reality check',
      status: 'Terminated'
    }));

    return NextResponse.json({
      killed_components: killedComponents,
      message: `${killedComponents.length} components terminated. Time saved for actual products.`,
      next_action: 'Focus resources on components that pass reality checks'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// Helper functions

function runRealityCheck(component: Component) {
  const score = calculateRealityScore(
    component.solves_real_problem,
    component.would_pay_today,
    component.can_demo_60_seconds
  );

  return {
    component_id: component.component_id,
    module_name: component.module_name,
    score,
    classification: classifyComponent(
      component.solves_real_problem,
      component.would_pay_today,
      component.can_demo_60_seconds
    ),
    brutal_questions: [
      {
        question: 'Does this solve a real problem?',
        answer: component.solves_real_problem ? 'Yes' : 'No',
        weight: 0.4
      },
      {
        question: 'Would someone pay for this TODAY?',
        answer: component.would_pay_today ? 'Yes' : 'No',
        weight: 0.4
      },
      {
        question: 'Can it be demoed in 60 seconds?',
        answer: component.can_demo_60_seconds ? 'Yes' : 'No',
        weight: 0.2
      }
    ],
    recommendation: getRealityRecommendation(score),
    should_kill: score < 0.4
  };
}

function calculateRealityScore(solves: boolean, pays: boolean, demos: boolean): number {
  let score = 0;
  if (solves) score += 0.4;
  if (pays) score += 0.4;
  if (demos) score += 0.2;
  return score;
}

function classifyComponent(solves: boolean, pays: boolean, demos: boolean): string {
  const score = calculateRealityScore(solves, pays, demos);
  
  if (score >= 0.8) return 'Product';
  if (score >= 0.6) return 'Potential Product';
  if (score >= 0.4) return 'R&D';
  return 'Time Waster';
}

function getRealityRecommendation(score: number): string {
  if (score >= 0.8) return 'Immediate focus - this is a real product';
  if (score >= 0.6) return 'High priority - fix remaining issues';
  if (score >= 0.4) return 'Consider as R&D or kill it';
  return 'Kill immediately - this is a waste of time';
}

function generateRealitySummary(realityChecks: any[]) {
  const total = realityChecks.length;
  const products = realityChecks.filter(r => r.classification === 'Product').length;
  const potential = realityChecks.filter(r => r.classification === 'Potential Product').length;
  const rd = realityChecks.filter(r => r.classification === 'R&D').length;
  const timeWasters = realityChecks.filter(r => r.classification === 'Time Waster').length;

  return {
    total_components: total,
    products,
    potential_products: potential,
    rd_projects: rd,
    time_wasters: timeWasters,
    reality_score: total > 0 ? ((products * 1.0 + potential * 0.6 + rd * 0.3) / total) : 0,
    brutal_assessment: timeWasters > total / 2 ? 
      'Most of your work is wasting time' : 
      'Some product potential exists'
  };
}

function generateRealityRecommendations(realityCheck: any): string[] {
  const { score, classification } = realityCheck;

  if (classification === 'Product') {
    return [
      'Execute immediately',
      'Focus all resources here',
      'Scale and optimize'
    ];
  }

  if (classification === 'Potential Product') {
    return [
      'Identify and fix remaining issues',
      'Test market demand',
      'Consider if worth the investment'
    ];
  }

  if (classification === 'R&D') {
    return [
      'Stop calling it a product',
      'Document as research project',
      'Extract useful components',
      'Move on to actual products'
    ];
  }

  return [
    'Kill immediately',
    'Learn from mistakes',
    'Don\'t repeat same patterns',
    'Focus on problems people will pay to solve'
  ];
}

function getBrutalHonesty(realityCheck: any): string {
  const { classification, score } = realityCheck;

  switch (classification) {
    case 'Product':
      return 'This could actually make money. Don\'t screw it up.';
    case 'Potential Product':
      return 'Maybe. But probably not. Fix the obvious issues first.';
    case 'R&D':
      return 'You\'re lying to yourself calling this a product. It\'s research.';
    case 'Time Waster':
      return 'This is a hobby with good branding. Kill it before it wastes more time.';
    default:
      return 'Figure out what this actually is before proceeding.';
  }
}
