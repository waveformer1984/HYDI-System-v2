import { NextRequest, NextResponse } from 'next/server';
import { Component, CreateComponentRequest, UpdateComponentRequest, CrossCheckResponse } from '@/lib/ucmrs/types';

// Mock database - replace with actual DB connection
const components: Component[] = [];
let nextId = 1;

// GET /api/ucmrs/components - List all components with cross-check
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const moduleParam = searchParams.get('module');
  const category = searchParams.get('category');
  const includeAlerts = searchParams.get('includeAlerts') === 'true';

  let filteredComponents = components;

  if (moduleParam) {
    filteredComponents = filteredComponents.filter(c => c.module_name === moduleParam);
  }

  if (category) {
    filteredComponents = filteredComponents.filter(c => c.category === category);
  }

  if (includeAlerts) {
    const crossCheck = await runCrossCheck(filteredComponents);
    return NextResponse.json({
      components: filteredComponents,
      alerts: crossCheck.alerts,
      summary: crossCheck.summary
    });
  }

  return NextResponse.json({ components: filteredComponents });
}

// POST /api/ucmrs/components - Create new component
export async function POST(request: NextRequest) {
  try {
    const body: CreateComponentRequest = await request.json();

    // Validate required fields
    if (!body.component_id || !body.module_name || !body.category || !body.monetization_class) {
      return NextResponse.json(
        { error: 'Missing required fields: component_id, module_name, category, monetization_class' },
        { status: 400 }
      );
    }

    // Check for duplicate component_id
    if (components.find(c => c.component_id === body.component_id)) {
      return NextResponse.json(
        { error: 'Component ID already exists' },
        { status: 409 }
      );
    }

    const newComponent: Component = {
      id: (nextId++).toString(),
      component_id: body.component_id,
      module_name: body.module_name,
      category: body.category,
      physical_status: 'Not Acquired',
      ursula_status: 'Not Registered',
      input_type: undefined,
      output_type: undefined,
      protocol: undefined,
      update_rate: undefined,
      requires: [],
      feeds: [],
      failure_risk_level: 'Medium',
      monetization_class: body.monetization_class,
      revenue_path: body.revenue_path || 'Direct Sale',
      validation_status: 'Not Verified',
      solves_real_problem: body.solves_real_problem,
      would_pay_today: body.would_pay_today,
      can_demo_60_seconds: body.can_demo_60_seconds,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    components.push(newComponent);

    // Run cross-check on new component
    const crossCheck = await runCrossCheck([newComponent]);

    return NextResponse.json({
      component: newComponent,
      alerts: crossCheck.alerts,
      message: 'Component created. Review alerts for integration gaps.'
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/components - Update component (id in body)
export async function PUT(request: NextRequest) {
  try {
    const body: UpdateComponentRequest & { id: string } = await request.json();
    const componentIndex = components.findIndex(c => c.id === body.id);

    if (componentIndex === -1) {
      return NextResponse.json(
        { error: 'Component not found' },
        { status: 404 }
      );
    }

    const component = components[componentIndex];
    const previousStatus = component.ursula_status;

    // Update component
    const updatedComponent = {
      ...component,
      ...body,
      updated_at: new Date().toISOString()
    };

    components[componentIndex] = updatedComponent;

    // Track integration level changes
    if (body.ursula_status && body.ursula_status !== previousStatus) {
      // This would normally go to integration_audit table
      console.log(`Integration level changed for ${component.component_id}: ${previousStatus} -> ${body.ursula_status}`);
    }

    // Run cross-check
    const crossCheck = await runCrossCheck([updatedComponent]);

    return NextResponse.json({
      component: updatedComponent,
      alerts: crossCheck.alerts,
      message: 'Component updated. Review alerts for new issues.'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// DELETE /api/ucmrs/components - Remove component (id in query)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const componentIndex = components.findIndex(c => c.id === id);

  if (componentIndex === -1) {
    return NextResponse.json(
      { error: 'Component not found' },
      { status: 404 }
    );
  }

  const component = components[componentIndex];
  components.splice(componentIndex, 1);

  return NextResponse.json({
    message: `Component ${component.component_id} removed from registry`
  });
}

// Cross-check logic - The annoying project manager
async function runCrossCheck(componentsToCheck: Component[]): Promise<CrossCheckResponse> {
  const { CROSS_CHECK_RULES } = await import('@/lib/ucmrs/types');
  const alerts: any[] = [];

  for (const component of componentsToCheck) {
    for (const rule of CROSS_CHECK_RULES) {
      if (rule.condition(component)) {
        alerts.push({
          id: (Date.now() + Math.random()).toString(),
          component_id: component.component_id,
          alert_type: rule.alert_type,
          message: rule.message,
          severity: rule.severity,
          status: 'Open',
          created_at: new Date().toISOString()
        });
      }
    }
  }

  // Calculate summary metrics
  const summary = {
    total_components: components.length,
    critical_issues: alerts.filter(a => a.severity === 'Critical').length,
    demo_risks: alerts.filter(a => a.severity === 'Demo Risk').length,
    monetization_ready: components.filter(c => c.monetization_class !== 'Internal Only').length,
    reality_products: components.filter(c => 
      c.solves_real_problem && c.would_pay_today && c.can_demo_60_seconds
    ).length
  };

  return { alerts, summary };
}
