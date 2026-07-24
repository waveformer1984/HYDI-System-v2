import { NextRequest, NextResponse } from 'next/server';
import { Component, IntegrationAudit } from '@/lib/ucmrs/types';

// Mock database - replace with actual DB connection
const integrationAudits: IntegrationAudit[] = [];
let nextId = 1;

// GET /api/ucmrs/integration - Get integration status and tiers
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get('componentId');
  const moduleName = searchParams.get('module');
  const tier = searchParams.get('tier'); // 0-5

  // This would normally query actual component data
  // For now, we'll use mock data
  const mockComponents: Component[] = [
    {
      id: '1',
      component_id: 'LASER_HARP_01',
      module_name: 'Laser Harp System',
      category: 'Audio',
      physical_status: 'Tested',
      ursula_status: 'Streaming Data',
      input_type: 'Laser beam break',
      output_type: 'MIDI note',
      protocol: 'Custom',
      update_rate: 1000,
      requires: ['LASER_SENSOR_01', 'MIDI_CONTROLLER_01'],
      feeds: ['AUDIO_PROCESSOR_01'],
      failure_risk_level: 'Medium',
      monetization_class: 'Core Product',
      revenue_path: 'Direct Sale',
      validation_status: 'Bench Verified',
      solves_real_problem: true,
      would_pay_today: true,
      can_demo_60_seconds: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z'
    }
  ];

  let filteredComponents = mockComponents;

  if (componentId) {
    filteredComponents = filteredComponents.filter(c => c.component_id === componentId);
  }

  if (moduleName) {
    filteredComponents = filteredComponents.filter(c => c.module_name === moduleName);
  }

  if (tier) {
    const tierNumber = parseInt(tier);
    filteredComponents = filteredComponents.filter(c => getIntegrationLevel(c.ursula_status) === tierNumber);
  }

  const integrationSummary = calculateIntegrationSummary(filteredComponents);

  return NextResponse.json({
    components: filteredComponents,
    summary: integrationSummary,
    tiers: getIntegrationTierBreakdown(filteredComponents)
  });
}

// POST /api/ucmrs/integration/promote - Promote component to next integration tier
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component_id, new_status, notes, changed_by } = body;

    if (!component_id || !new_status || !changed_by) {
      return NextResponse.json(
        { error: 'Missing required fields: component_id, new_status, changed_by' },
        { status: 400 }
      );
    }

    // Validate the integration tier progression
    const validProgression = validateIntegrationProgression(new_status);
    if (!validProgression.valid) {
      return NextResponse.json(
        { error: validProgression.error },
        { status: 400 }
      );
    }

    // Create audit entry
    const audit: IntegrationAudit = {
      id: (nextId++).toString(),
      component_id,
      previous_level: 'Streaming Data', // This would come from current component state
      new_level: new_status,
      changed_by,
      notes: notes || `Integration level promoted to ${new_status}`,
      created_at: new Date().toISOString()
    };

    integrationAudits.push(audit);

    // Generate promotion requirements
    const requirements = getNextTierRequirements(new_status);

    return NextResponse.json({
      audit,
      requirements,
      message: `Component ${component_id} integration level updated to ${new_status}`,
      next_steps: `Complete requirements: ${requirements.join(', ')}`
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/integration/audit - Get integration audit trail
export async function GET_AUDIT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get('componentId');
  const limit = parseInt(searchParams.get('limit') || '50');

  let filteredAudits = integrationAudits;

  if (componentId) {
    filteredAudits = filteredAudits.filter(a => a.component_id === componentId);
  }

  // Sort by most recent first
  filteredAudits.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({
    audits: filteredAudits.slice(0, limit),
    total: filteredAudits.length
  });
}

// GET /api/ucmrs/integration/bottlenecks - Identify integration bottlenecks
export async function GET_BOTTLENECKS(request: NextRequest) {
  // This would normally analyze all components
  // For now, return mock bottleneck analysis
  
  const bottlenecks = [
    {
      type: 'Physical Validation',
      severity: 'High',
      affected_components: 3,
      description: 'Components stuck at "Acquired" status need physical mounting',
      recommended_action: 'Schedule hardware mounting session'
    },
    {
      type: 'Addressability',
      severity: 'Medium',
      affected_components: 2,
      description: 'Components registered but not addressable by Ursula',
      recommended_action: 'Check I2C/SPI addressing and wiring'
    },
    {
      type: 'Control Logic',
      severity: 'Low',
      affected_components: 1,
      description: 'Component streaming data but not controllable',
      recommended_action: 'Implement control endpoints'
    }
  ];

  return NextResponse.json({ bottlenecks });
}

// GET /api/ucmrs/integration/progress - Get overall integration progress
export async function GET_PROGRESS(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const moduleName = searchParams.get('module');

  // Mock progress calculation
  const progress = {
    overall: {
      total_components: 12,
      level_0: 2, // Physical only
      level_1: 3, // Registered
      level_2: 4, // Data visible
      level_3: 2, // Controllable
      level_4: 1, // Automated
      level_5: 0, // Monetizable
      integration_percentage: 58.3
    },
    by_module: moduleName ? {
      [moduleName]: {
        total_components: 5,
        integration_percentage: 40.0,
        highest_tier: 3
      }
    } : {},
    milestones: {
      next_tier_3: '2 components need control implementation',
      next_tier_4: '1 component needs automation logic',
      next_tier_5: 'All components need monetization mapping'
    },
    estimated_completion: '3-4 weeks at current pace'
  };

  return NextResponse.json(progress);
}

// Helper functions

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

function calculateIntegrationSummary(components: Component[]) {
  const total = components.length;
  const levelCounts = [0, 0, 0, 0, 0, 0];
  
  components.forEach(c => {
    const level = getIntegrationLevel(c.ursula_status);
    levelCounts[level]++;
  });

  return {
    total_components: total,
    level_distribution: levelCounts,
    integration_rate: total > 0 ? Math.round(((levelCounts[3] + levelCounts[4] + levelCounts[5]) / total) * 100) : 0,
    monetization_rate: total > 0 ? Math.round((levelCounts[5] / total) * 100) : 0
  };
}

function getIntegrationTierBreakdown(components: Component[]) {
  const tiers = [
    { level: 0, name: 'Physical Only', description: 'Exists physically (congrats)', count: 0 },
    { level: 1, name: 'Registered', description: 'Registered in Ursula', count: 0 },
    { level: 2, name: 'Data Visible', description: 'Data visible', count: 0 },
    { level: 3, name: 'Controllable', description: 'Controllable', count: 0 },
    { level: 4, name: 'Automated', description: 'Automated behavior', count: 0 },
    { level: 5, name: 'Monetizable', description: 'Monetizable feature', count: 0 }
  ];

  components.forEach(c => {
    const level = getIntegrationLevel(c.ursula_status);
    if (level < tiers.length) {
      tiers[level].count++;
    }
  });

  return tiers;
}

function validateIntegrationProgression(newStatus: string) {
  const validStatuses = ['Registered', 'Addressable', 'Streaming Data', 'Controlled', 'Automated', 'Monetizable'];
  
  if (!validStatuses.includes(newStatus)) {
    return { valid: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` };
  }

  return { valid: true };
}

function getNextTierRequirements(status: string): string[] {
  const requirements: Record<string, string[]> = {
    'Registered': ['Physical mounting', 'Basic wiring', 'Power connection'],
    'Addressable': ['I2C/SPI address assignment', 'Communication protocol setup', 'Basic detection'],
    'Streaming Data': ['Data endpoint implementation', 'Rate limiting', 'Error handling'],
    'Controlled': ['Control endpoints', 'Safety limits', 'State management'],
    'Automated': ['Automation logic', 'Trigger conditions', 'Fallback mechanisms'],
    'Monetizable': ['Revenue model definition', 'Pricing structure', 'Market validation']
  };

  return requirements[status] || [];
}
