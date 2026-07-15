import { NextRequest, NextResponse } from 'next/server';
import { BusinessDirection, BUSINESS_DIRECTIONS } from '@/lib/ucmrs/types-ral';
import { Component } from '@/lib/ucmrs/types';

// GET /api/ucmrs/ral/direction - Get module business direction map
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const moduleName = searchParams.get('module');
  const priority = searchParams.get('priority');

  let directions = Object.values(BUSINESS_DIRECTIONS);

  // Update with current component data (mock for now)
  directions = updateDirectionsWithCurrentData(directions);

  if (moduleName) {
    directions = directions.filter(d => d.module_name === moduleName);
  }

  if (priority) {
    directions = directions.filter(d => d.priority === priority);
  }

  // Sort by priority and readiness
  const priorityOrder = { 'Focus Now': 4, 'Secondary': 3, 'Future': 2, 'Archive': 1 };
  directions.sort((a, b) => {
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.readiness_score - a.readiness_score;
  });

  return NextResponse.json({ directions });
}

// POST /api/ucmrs/ral/direction/analyze - Analyze modules and assign directions
export async function POST_ANALYZE(request: NextRequest) {
  try {
    const body = await request.json();
    const { modules } = body;

    if (!modules || !Array.isArray(modules)) {
      return NextResponse.json(
        { error: 'Missing required field: modules (array)' },
        { status: 400 }
      );
    }

    const analysis = modules.map((moduleName: string) => {
      // Determine business direction based on module name patterns
      const direction = determineBusinessDirection(moduleName);

      // Mock component analysis
      const mockComponents: Component[] = [
        {
          id: '1',
          component_id: 'SAMPLE_01',
          module_name: moduleName,
          ursula_status: 'Controlled',
          validation_status: 'System Verified'
        } as Component
      ];

      const level3Plus = mockComponents.filter(c => getIntegrationLevel(c.ursula_status) >= 3).length;
      const readiness = calculateReadinessScore(mockComponents.length);

      return {
        module_name: moduleName,
        assigned_direction: direction.module_name,
        priority: direction.priority,
        time_to_first_dollar_target: direction.time_to_first_dollar_target,
        current_components: mockComponents.length,
        level_3_plus_components: level3Plus,
        readiness_score: readiness,
        recommendation: generateModuleRecommendation(direction, level3Plus, readiness),
        brutal_assessment: generateBrutalAssessment(direction, level3Plus, readiness)
      };
    });

    return NextResponse.json({
      analysis,
      summary: {
        total_modules: modules.length,
        focus_now: analysis.filter(a => a.priority === 'Focus Now').length,
        secondary: analysis.filter(a => a.priority === 'Secondary').length,
        future: analysis.filter(a => a.priority === 'Future').length,
        archive: analysis.filter(a => a.priority === 'Archive').length
      }
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/ral/direction/[module]/prescriptive - Get prescriptive direction for specific module
export async function GET_PRESCRIPTIVE(request: NextRequest, { params }: { params: { module: string } }) {
  const moduleName = params.module;
  const direction = BUSINESS_DIRECTIONS[moduleName];

  if (!direction) {
    return NextResponse.json({ error: 'Module direction not found' }, { status: 404 });
  }

  const prescriptive = generateModulePrescriptive(direction);

  return NextResponse.json({
    module_name: moduleName,
    direction: direction,
    prescriptive_actions: prescriptive.actions,
    timeline: prescriptive.timeline,
    revenue_path: prescriptive.revenue_path,
    kill_criteria: prescriptive.kill_criteria,
    success_metrics: prescriptive.success_metrics
  });
}

// GET /api/ucmrs/ral/direction/focus - Get what to focus on right now
export async function GET_FOCUS(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get('timeframe') || '30d';

  // Update directions with current data
  const updatedDirections = updateDirectionsWithCurrentData(Object.values(BUSINESS_DIRECTIONS));

  const focusNow = updatedDirections.filter(d => d.priority === 'Focus Now');
  const secondary = updatedDirections.filter(d => d.priority === 'Secondary');

  const focus = {
    immediate_focus: focusNow.length > 0 ? focusNow[0] : null,
    this_week: {
      primary: focusNow.length > 0 ? focusNow[0].module_name : 'No modules ready',
      actions: focusNow.length > 0 ? generateWeeklyActions(focusNow[0]) : ['Build more Level 3+ components']
    },
    this_month: {
      primary_modules: focusNow.map(d => d.module_name),
      secondary_modules: secondary.map(d => d.module_name),
      target_revenue: calculateTargetRevenue(focusNow, secondary),
      success_probability: calculateSuccessProbability(focusNow, secondary)
    },
    brutal_reality: {
      actually_ready: focusNow.filter(d => d.readiness_score >= 7).length,
      needs_work: focusNow.filter(d => d.readiness_score < 7).length,
      time_wasters: updatedDirections.filter(d => d.priority === 'Archive').length,
      assessment: generateRealityAssessment(focusNow, secondary)
    },
    consequence: {
      if_focus_maintained: 'Revenue in 30-60 days',
      if_distracted: 'Another month of building with no income',
      recommendation: focusNow.length > 0 ?
        `Focus exclusively on ${focusNow[0].module_name}` :
        'Get any module to Level 3+ before worrying about direction'
    }
  };

  return NextResponse.json(focus);
}

// GET /api/ucmrs/ral/direction/kill-list - Modules to terminate
export async function GET_KILL_LIST(request: NextRequest) {
  const updatedDirections = updateDirectionsWithCurrentData(Object.values(BUSINESS_DIRECTIONS));

  const killCandidates = updatedDirections.filter(d => {
    return d.priority === 'Archive' ||
      d.readiness_score < 3 ||
      d.level_3_plus_components === 0;
  });

  const killList = killCandidates.map(direction => ({
    module_name: direction.module_name,
    reason: determineKillReason(direction),
    time_invested: estimateTimeInvested(direction),
    salvage_value: determineSalvageValue(direction),
    recommendation: generateKillRecommendation(direction),
    emotional_resistance: calculateEmotionalResistance(direction)
  }));

  return NextResponse.json({
    kill_list: killList,
    total_time_wasted: killList.reduce((total, item) => total + (item.time_invested || 0), 0),
    potential_savings: killList.reduce((total, item) => total + (item.salvage_value || 0), 0),
    brutal_message: killList.length > 0 ?
      `Kill ${killList.length} modules immediately. You're wasting time on dead ends.` :
      'No modules need termination. Keep building.',
    next_action: killList.length > 0 ?
      'Execute terminations and focus on revenue-generating modules' :
      'Continue current development'
  });
}

// POST /api/ucmrs/ral/direction/execute-kill - Execute module termination
export async function POST_EXECUTE_KILL(request: NextRequest) {
  try {
    const body = await request.json();
    const { module_names, confirmation } = body;

    if (!module_names || !Array.isArray(module_names)) {
      return NextResponse.json(
        { error: 'Missing required field: module_names (array)' },
        { status: 400 }
      );
    }

    if (!confirmation || confirmation !== 'I understand this kills the module permanently') {
      return NextResponse.json(
        { error: 'Must confirm understanding of permanent termination' },
        { status: 400 }
      );
    }

    // Mock execution - in reality this would update database, archive components, etc.
    const killedModules = module_names.map((moduleName: string) => ({
      module_name: moduleName,
      killed_at: new Date().toISOString(),
      status: 'Terminated',
      reason: 'Failed business direction assessment'
    }));

    return NextResponse.json({
      killed_modules: killedModules,
      message: `${killedModules.length} modules terminated. Time freed for actual revenue generation.`,
      opportunity_cost_saved: killedModules.length * 30, // 30 days per module
      refocus_instruction: 'Immediately focus on highest-readiness module'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// Helper functions

function updateDirectionsWithCurrentData(directions: BusinessDirection[]): BusinessDirection[] {
  // Mock data - replace with actual component queries
  const mockModuleData: Record<string, { components: number; level3Plus: number }> = {
    'Audio / Synth / Control Systems': { components: 5, level3Plus: 3 },
    'Motion / Rail / Mechanical Systems': { components: 4, level3Plus: 2 },
    'Power / Experimental Systems': { components: 3, level3Plus: 1 },
    'Ursula (Control + Intelligence Layer)': { components: 8, level3Plus: 4 }
  };

  return directions.map(direction => ({
    ...direction,
    current_components: mockModuleData[direction.module_name]?.components || 0,
    level_3_plus_components: mockModuleData[direction.module_name]?.level3Plus || 0,
    readiness_score: calculateReadinessScore(mockModuleData[direction.module_name]?.components || 0)
  }));
}

function determineBusinessDirection(moduleName: string): BusinessDirection {
  const name = moduleName.toLowerCase();

  if (name.includes('audio') || name.includes('synth') || name.includes('sound') || name.includes('midi')) {
    return BUSINESS_DIRECTIONS['Audio / Synth / Control Systems'];
  }

  if (name.includes('motion') || name.includes('rail') || name.includes('mechanical') || name.includes('motor')) {
    return BUSINESS_DIRECTIONS['Motion / Rail / Mechanical Systems'];
  }

  if (name.includes('power') || name.includes('battery') || name.includes('experimental')) {
    return BUSINESS_DIRECTIONS['Power / Experimental Systems'];
  }

  if (name.includes('ursula') || name.includes('control') || name.includes('intelligence')) {
    return BUSINESS_DIRECTIONS['Ursula (Control + Intelligence Layer)'];
  }

  // Default to audio direction
  return BUSINESS_DIRECTIONS['Audio / Synth / Control Systems'];
}

function getIntegrationLevel(ursulaStatus: string): number {
  const levelMap: Record<string, number> = {
    'Not Registered': 0,
    'Registered': 1,
    'Addressable': 2,
    'Streaming Data': 2,
    'Controlled': 3,
    'Automated': 4,
    'Monetizable': 5
  };
  return levelMap[ursulaStatus] || 0;
}

function calculateReadinessScore(componentCount: number): number {
  // Simple readiness calculation based on component count
  if (componentCount >= 5) return 8;
  if (componentCount >= 3) return 6;
  if (componentCount >= 1) return 4;
  return 2;
}

function generateModuleRecommendation(direction: BusinessDirection, level3Plus: number, readiness: number): string {
  if (readiness >= 7 && level3Plus >= 3) {
    return `Ready for product collapse. Focus on ${direction.fast_money}.`;
  }

  if (readiness >= 5 && level3Plus >= 1) {
    return `Close to ready. Advance components to Level 3+.`;
  }

  if (direction.priority === 'Focus Now') {
    return `High priority but needs work. Accelerate development.`;
  }

  return `Lower priority. Maintain minimal effort until core modules succeed.`;
}

function generateBrutalAssessment(direction: BusinessDirection, level3Plus: number, readiness: number): string {
  if (direction.priority === 'Archive') {
    return 'Kill this module. It\'s a distraction from revenue.';
  }

  if (readiness < 5) {
    return 'Not ready for revenue. Either accelerate or kill.';
  }

  if (level3Plus < 2) {
    return 'Insufficient controllable components. Build more or abandon.';
  }

  return 'Potential exists but requires focused execution.';
}

function generateModulePrescriptive(direction: BusinessDirection) {
  return {
    actions: [
      `Focus on: ${direction.fast_money}`,
      `Long-term: ${direction.long_game}`,
      `Target: First dollar in ${direction.time_to_first_dollar_target} days`
    ],
    timeline: {
      'Week 1': 'Advance components to Level 3+',
      'Week 2': 'Build product collapse',
      'Week 3': 'Create revenue stream',
      'Week 4': 'Scale or pivot'
    },
    revenue_path: {
      immediate: direction.fast_money,
      sustainable: direction.long_game,
      timeline: `${direction.time_to_first_dollar_target} days to first revenue`
    },
    kill_criteria: `No Level 3+ components in ${direction.time_to_first_dollar_target * 2} days`,
    success_metrics: [
      `${direction.time_to_first_dollar_target} days to first dollar`,
      '3+ Level 3+ components',
      'Product collapse completed'
    ]
  };
}

function generateWeeklyActions(direction: BusinessDirection): string[] {
  return [
    `Advance ${direction.module_name} components`,
    `Focus on ${direction.fast_money}`,
    `Target: ${direction.time_to_first_dollar_target} days to revenue`
  ];
}

function calculateTargetRevenue(focusNow: BusinessDirection[], secondary: BusinessDirection[]): number {
  // Simple revenue calculation based on module readiness
  const focusRevenue = focusNow.reduce((total, dir) => total + (dir.readiness_score * 100), 0);
  const secondaryRevenue = secondary.reduce((total, dir) => total + (dir.readiness_score * 50), 0);
  return focusRevenue + secondaryRevenue;
}

function calculateSuccessProbability(focusNow: BusinessDirection[], secondary: BusinessDirection[]): number {
  const totalModules = focusNow.length + secondary.length;
  if (totalModules === 0) return 0;

  const avgReadiness = [...focusNow, ...secondary].reduce((sum, dir) => sum + dir.readiness_score, 0) / totalModules;
  return Math.round(avgReadiness * 10); // Convert to percentage
}

function generateRealityAssessment(focusNow: BusinessDirection[], secondary: BusinessDirection[]): string {
  const readyModules = [...focusNow, ...secondary].filter(d => d.readiness_score >= 7).length;

  if (readyModules === 0) {
    return 'No modules ready for revenue. Keep building.';
  }

  if (readyModules === 1) {
    return 'One module ready. Focus exclusively or fail.';
  }

  return 'Multiple modules ready. Execute on highest priority first.';
}

function determineKillReason(direction: BusinessDirection): string {
  if (direction.priority === 'Archive') return 'Strategic misalignment';
  if (direction.readiness_score < 3) return 'Insufficient progress';
  if (direction.level_3_plus_components === 0) return 'No controllable components';
  return 'Failed reality check';
}

function estimateTimeInvested(direction: BusinessDirection): number {
  // Mock time estimation based on component count
  return direction.current_components * 15; // 15 days per component
}

function determineSalvageValue(direction: BusinessDirection): number {
  // Components can be reused in other modules
  return direction.current_components * 5; // 5 days of value per component
}

function generateKillRecommendation(direction: BusinessDirection): string {
  if (direction.level_3_plus_components > 0) {
    return 'Extract Level 3+ components, kill the rest';
  }

  return 'Kill entirely and document lessons learned';
}

function calculateEmotionalResistance(direction: BusinessDirection): 'Low' | 'Medium' | 'High' {
  // Mock emotional attachment based on time invested
  if (direction.current_components > 5) return 'High';
  if (direction.current_components > 2) return 'Medium';
  return 'Low';
}
