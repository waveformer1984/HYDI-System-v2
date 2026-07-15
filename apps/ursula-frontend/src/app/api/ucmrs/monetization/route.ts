import { NextRequest, NextResponse } from 'next/server';
import { Component, MONETIZATION_DECISION_GRID } from '@/lib/ucmrs/types';

// GET /api/ucmrs/monetization - Get monetization analysis and recommendations
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get('componentId');
  const moduleName = searchParams.get('module');
  const includeRevenue = searchParams.get('includeRevenue') === 'true';

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
      // ... other fields
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z'
    } as Component,
    {
      id: '2',
      component_id: 'MOTION_SENSOR_01',
      module_name: 'Gesture Control',
      category: 'Sensor',
      physical_status: 'Tested',
      ursula_status: 'Controlled',
      monetization_class: 'Feature',
      revenue_path: 'Subscription',
      solves_real_problem: true,
      would_pay_today: false,
      can_demo_60_seconds: true,
      // ... other fields
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z'
    } as Component
  ];

  let filteredComponents = mockComponents;

  if (componentId) {
    filteredComponents = filteredComponents.filter(c => c.component_id === componentId);
  }

  if (moduleName) {
    filteredComponents = filteredComponents.filter(c => c.module_name === moduleName);
  }

  const monetizationAnalysis = analyzeMonetization(filteredComponents);

  if (includeRevenue) {
    const revenueProjection = calculateRevenueProjection(filteredComponents);
    return NextResponse.json({
      components: filteredComponents,
      analysis: monetizationAnalysis,
      revenue: revenueProjection
    });
  }

  return NextResponse.json({
    components: filteredComponents,
    analysis: monetizationAnalysis
  });
}

// POST /api/ucmrs/monetization/evaluate - Evaluate monetization potential
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component_id, category, solves_real_problem, would_pay_today, can_demo_60_seconds } = body;

    if (!component_id || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: component_id, category' },
        { status: 400 }
      );
    }

    const evaluation = evaluateMonetizationPotential({
      component_id,
      category,
      solves_real_problem,
      would_pay_today,
      can_demo_60_seconds
    });

    return NextResponse.json({
      evaluation,
      recommendations: generateMonetizationRecommendations(evaluation)
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/monetization/decision-grid - Get monetization decision matrix
export async function GET_DECISION_GRID(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');

  if (category && MONETIZATION_DECISION_GRID[category as keyof typeof MONETIZATION_DECISION_GRID]) {
    return NextResponse.json({
      category,
      recommendations: MONETIZATION_DECISION_GRID[category as keyof typeof MONETIZATION_DECISION_GRID],
      explanation: getCategoryExplanation(category)
    });
  }

  return NextResponse.json({
    decision_grid: MONETIZATION_DECISION_GRID,
    explanation: 'Humans buy the same five things forever. This grid predicts which ones.'
  });
}

// GET /api/ucmrs/monetization/revenue-potential - Calculate revenue potential
export async function GET_REVENUE_POTENTIAL(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const moduleId = searchParams.get('moduleId');

  // Mock revenue calculation
  const revenuePotential = {
    module_id: moduleId || 'all',
    scenarios: {
      conservative: {
        monthly_revenue: 2500,
        annual_revenue: 30000,
        confidence: 0.7,
        assumptions: ['10 customers @ $250/month', 'Low churn rate']
      },
      moderate: {
        monthly_revenue: 8500,
        annual_revenue: 102000,
        confidence: 0.5,
        assumptions: ['25 customers @ $340/month', 'Medium churn rate']
      },
      aggressive: {
        monthly_revenue: 25000,
        annual_revenue: 300000,
        confidence: 0.3,
        assumptions: ['50 customers @ $500/month', 'High churn rate']
      }
    },
    fastest_path: {
      timeline: '30 days',
      actions: ['Complete demo', 'Set pricing', 'Find first customer'],
      expected_revenue: 500
    },
    break_even: {
      development_cost: 15000,
      monthly_burn: 2000,
      months_to_break_even: 8,
      required_customers: 8
    }
  };

  return NextResponse.json(revenuePotential);
}

// GET /api/ucmrs/monetization/reality-check - Brutal reality filter
export async function GET_REALITY_CHECK(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get('componentId');

  // Mock reality check
  const realityCheck = {
    component_id: componentId || 'UNKNOWN',
    brutal_questions: [
      {
        question: 'Does this solve a real problem?',
        answer: componentId === 'LASER_HARP_01' ? 'Yes' : 'No',
        weight: 0.4
      },
      {
        question: 'Would someone pay for this TODAY?',
        answer: componentId === 'LASER_HARP_01' ? 'Maybe' : 'No',
        weight: 0.4
      },
      {
        question: 'Can it be demoed in 60 seconds?',
        answer: 'No',
        weight: 0.2
      }
    ],
    score: componentId === 'LASER_HARP_01' ? 0.6 : 0.0,
    classification: componentId === 'LASER_HARP_01' ? 'R&D with potential' : 'Pure R&D',
    recommendation: componentId === 'LASER_HARP_01' ? 
      'Fix demo capability before pursuing monetization' : 
      'Stop pretending this is a product. Call it R&D and move on.',
    next_steps: componentId === 'LASER_HARP_01' ? [
      'Create 60-second demo',
      'Find 3 potential customers',
      'Test pricing at $199-299'
    ] : [
      'Document as research project',
      'Extract useful components',
      'Focus on actual products'
    ]
  };

  return NextResponse.json(realityCheck);
}

// Helper functions

function analyzeMonetization(components: Component[]) {
  const total = components.length;
  const monetizationClasses = {
    'Core Product': 0,
    'Feature': 0,
    'Add-on': 0,
    'Internal Only': 0,
    'Licensing Candidate': 0
  };

  const revenuePaths = {
    'Direct Sale': 0,
    'Subscription': 0,
    'Data Service': 0,
    'Licensing': 0,
    'Bundled': 0
  };

  let realityProducts = 0;
  let rdProjects = 0;

  components.forEach(c => {
    monetizationClasses[c.monetization_class]++;
    revenuePaths[c.revenue_path]++;

    if (c.solves_real_problem && c.would_pay_today && c.can_demo_60_seconds) {
      realityProducts++;
    } else {
      rdProjects++;
    }
  });

  return {
    total_components: total,
    monetization_breakdown: monetizationClasses,
    revenue_path_breakdown: revenuePaths,
    reality_filter: {
      products: realityProducts,
      rd_projects: rdProjects,
      product_ratio: total > 0 ? Math.round((realityProducts / total) * 100) : 0
    },
    monetization_readiness: total > 0 ? Math.round((realityProducts / total) * 100) : 0
  };
}

function evaluateMonetizationPotential(component: any) {
  const score = calculateMonetizationScore(component);
  const classification = score >= 0.8 ? 'Product' : score >= 0.5 ? 'Potential Product' : 'R&D';

  return {
    component_id: component.component_id,
    score,
    classification,
    strengths: identifyStrengths(component),
    weaknesses: identifyWeaknesses(component),
    optimal_monetization: suggestOptimalMonetization(component.category),
    time_to_market: estimateTimeToMarket(component),
    investment_required: estimateInvestment(component)
  };
}

function calculateMonetizationScore(component: any): number {
  let score = 0;
  
  if (component.solves_real_problem) score += 0.4;
  if (component.would_pay_today) score += 0.4;
  if (component.can_demo_60_seconds) score += 0.2;

  return score;
}

function identifyStrengths(component: any): string[] {
  const strengths = [];
  
  if (component.solves_real_problem) strengths.push('Solves real problem');
  if (component.would_pay_today) strengths.push('Market demand exists');
  if (component.can_demo_60_seconds) strengths.push('Demo-ready');
  if (component.category === 'Audio') strengths.push('Premium audio market');
  if (component.category === 'Sensor') strengths.push('Data monetization potential');

  return strengths;
}

function identifyWeaknesses(component: any): string[] {
  const weaknesses = [];
  
  if (!component.solves_real_problem) weaknesses.push('No clear problem solved');
  if (!component.would_pay_today) weaknesses.push('No immediate market demand');
  if (!component.can_demo_60_seconds) weaknesses.push('Cannot demo quickly');
  if (component.category === 'Structure') weaknesses.push('Hard to monetize directly');

  return weaknesses;
}

function suggestOptimalMonetization(category: string): string {
  const suggestions = MONETIZATION_DECISION_GRID[category as keyof typeof MONETIZATION_DECISION_GRID];
  return suggestions ? suggestions[0] : 'Direct Sale';
}

function estimateTimeToMarket(component: any): string {
  if (component.can_demo_60_seconds && component.would_pay_today) return '1-2 months';
  if (component.solves_real_problem) return '3-6 months';
  return '6+ months';
}

function estimateInvestment(component: any): number {
  if (component.can_demo_60_seconds) return 5000;
  if (component.solves_real_problem) return 15000;
  return 25000;
}

function generateMonetizationRecommendations(evaluation: any): string[] {
  const recommendations = [];

  if (evaluation.classification === 'Product') {
    recommendations.push('Immediate: Create pricing structure');
    recommendations.push('Short-term: Find first 10 customers');
    recommendations.push('Long-term: Scale to subscription model');
  } else if (evaluation.classification === 'Potential Product') {
    recommendations.push('Fix weaknesses identified above');
    recommendations.push('Improve demo capability');
    recommendations.push('Validate market demand');
  } else {
    recommendations.push('Reclassify as R&D project');
    recommendations.push('Extract useful components');
    recommendations.push('Focus on actual products');
  }

  return recommendations;
}

function calculateRevenueProjection(components: Component[]) {
  const monthlyProjections = components.map(c => {
    let baseRevenue = 0;
    
    switch (c.revenue_path) {
      case 'Direct Sale':
        baseRevenue = 299; // One-time, spread over 12 months
        break;
      case 'Subscription':
        baseRevenue = 49;
        break;
      case 'Data Service':
        baseRevenue = 199;
        break;
      case 'Licensing':
        baseRevenue = 1000;
        break;
      case 'Bundled':
        baseRevenue = 99;
        break;
    }

    return {
      component_id: c.component_id,
      monthly_revenue: baseRevenue,
      confidence: c.would_pay_today ? 0.7 : 0.3
    };
  });

  const totalMonthly = monthlyProjections.reduce((sum, p) => sum + (p.monthly_revenue * p.confidence), 0);

  return {
    monthly_projection: Math.round(totalMonthly),
    annual_projection: Math.round(totalMonthly * 12),
    component_breakdown: monthlyProjections,
    confidence_score: monthlyProjections.reduce((sum, p) => sum + p.confidence, 0) / monthlyProjections.length
  };
}

function getCategoryExplanation(category: string): string {
  const explanations: Record<string, string> = {
    'Sensors': 'Sensors generate continuous data streams that can be monetized through analytics, monitoring services, and insights.',
    'Audio systems': 'Audio hardware is a premium market where quality and features justify higher price points.',
    'Motion systems': 'Motion control enables premium features and automation capabilities.',
    'Power systems': 'Reliability and efficiency in power systems command premium pricing and upsell opportunities.',
    'AI / control logic': 'Intelligent systems naturally fit subscription models with continuous value delivery.',
    'Structural design': 'Design innovations are best monetized through licensing rather than direct sales.'
  };

  return explanations[category] || 'Standard product monetization applies.';
}
