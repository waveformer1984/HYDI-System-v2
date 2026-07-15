import { NextRequest, NextResponse } from 'next/server';
import { Module } from '@/lib/ucmrs/types';

// Mock database - replace with actual DB connection
let modules: Module[] = [];
let nextId = 1;

// GET /api/ucmrs/modules - List all modules with health metrics
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const moduleName = searchParams.get('module');
  const includeHealth = searchParams.get('includeHealth') === 'true';

  if (moduleName) {
    const module = modules.find(m => m.module_name === moduleName);
    if (!module) {
      return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    }

    if (includeHealth) {
      const health = await calculateModuleHealth(module);
      return NextResponse.json({ module, health });
    }

    return NextResponse.json({ module });
  }

  if (includeHealth) {
    const modulesWithHealth = await Promise.all(
      modules.map(async (module) => ({
        module,
        health: await calculateModuleHealth(module)
      }))
    );
    return NextResponse.json({ modules: modulesWithHealth });
  }

  return NextResponse.json({ modules });
}

// POST /api/ucmrs/modules - Create new module or update existing
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.module_name) {
      return NextResponse.json(
        { error: 'Missing required field: module_name' },
        { status: 400 }
      );
    }

    const existingModule = modules.find(m => m.module_name === body.module_name);

    if (existingModule) {
      // Update existing module
      const updatedModule = {
        ...existingModule,
        ...body,
        updated_at: new Date().toISOString()
      };

      const moduleIndex = modules.findIndex(m => m.id === existingModule.id);
      modules[moduleIndex] = updatedModule;

      return NextResponse.json({
        module: updatedModule,
        message: 'Module updated successfully'
      });
    } else {
      // Create new module
      const newModule: Module = {
        id: (nextId++).toString(),
        module_name: body.module_name,
        level_0_count: 0,
        level_1_count: 0,
        level_2_count: 0,
        level_3_count: 0,
        level_4_count: 0,
        level_5_count: 0,
        stability_score: body.stability_score || 0,
        monetization_readiness: body.monetization_readiness || 0,
        critical_gaps: body.critical_gaps || [],
        fastest_revenue_path: body.fastest_revenue_path || 'Not defined',
        upgrade_path: body.upgrade_path || 'Not defined',
        kill_criteria: body.kill_criteria || 'Not defined',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      modules.push(newModule);

      return NextResponse.json({
        module: newModule,
        message: 'Module created successfully'
      }, { status: 201 });
    }

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/modules - Update module (id in body)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body.id as string;
    const moduleIndex = modules.findIndex(m => m.id === id);

    if (moduleIndex === -1) {
      return NextResponse.json(
        { error: 'Module not found' },
        { status: 404 }
      );
    }

    const updatedModule = {
      ...modules[moduleIndex],
      ...body,
      updated_at: new Date().toISOString()
    };

    modules[moduleIndex] = updatedModule;

    return NextResponse.json({
      module: updatedModule,
      message: 'Module updated successfully'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/modules/strategy - Get module strategy recommendations (id in query)
export async function GET_STRATEGY(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const module = modules.find(m => m.id === id);

  if (!module) {
    return NextResponse.json({ error: 'Module not found' }, { status: 404 });
  }

  const strategy = generateModuleStrategy(module);
  return NextResponse.json(strategy);
}

// POST /api/ucmrs/modules/recalculate - Recalculate module metrics from components (id in query)
export async function RECALCULATE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const module = modules.find(m => m.id === id);

  if (!module) {
    return NextResponse.json({ error: 'Module not found' }, { status: 404 });
  }

  try {
    // This would normally query the components table
    // For now, we'll simulate the calculation
    const recalculatedMetrics = await calculateModuleMetrics(module.module_name);
    
    const updatedModule = {
      ...module,
      ...recalculatedMetrics,
      updated_at: new Date().toISOString()
    };

    const moduleIndex = modules.findIndex(m => m.id === id);
    modules[moduleIndex] = updatedModule;

    return NextResponse.json({
      module: updatedModule,
      message: 'Module metrics recalculated from component data'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to recalculate metrics' },
      { status: 500 }
    );
  }
}

// Brutal strategy generation - No sugarcoating
function generateModuleStrategy(module: Module) {
  const totalComponents = module.level_0_count + module.level_1_count + module.level_2_count + 
                         module.level_3_count + module.level_4_count + module.level_5_count;

  const controllableComponents = module.level_3_count + module.level_4_count + module.level_5_count;
  const monetizableComponents = module.level_5_count;

  return {
    module_name: module.module_name,
    
    current_state: {
      total_components: totalComponents,
      controllable_components: controllableComponents,
      monetizable_components: monetizableComponents,
      stability_score: module.stability_score,
      monetization_readiness: module.monetization_readiness
    },

    brutal_assessment: {
      is_useful: controllableComponents > 0,
      is_product: monetizableComponents > 0 && module.monetization_readiness >= 7,
      is_hobby: monetizableComponents === 0,
      needs_work: module.stability_score < 7
    },

    reality_check: {
      can_demo_60_seconds: module.level_3_count >= 1, // At least one controllable component
      solves_real_problem: module.critical_gaps.length === 0,
      would_pay_today: module.monetization_readiness >= 8
    },

    recommendations: {
      immediate_focus: module.critical_gaps.length > 0 ? module.critical_gaps[0] : 'Stabilize existing components',
      fastest_revenue_path: module.fastest_revenue_path,
      upgrade_strategy: module.upgrade_path,
      kill_decision: module.kill_criteria
    },

    success_probability: {
      technical: module.stability_score / 10,
      commercial: module.monetization_readiness / 10,
      overall: ((module.stability_score + module.monetization_readiness) / 20)
    }
  };
}

// Calculate module health metrics
async function calculateModuleHealth(module: Module) {
  const totalComponents = module.level_0_count + module.level_1_count + module.level_2_count + 
                         module.level_3_count + module.level_4_count + module.level_5_count;

  const integrationRate = totalComponents > 0 ? 
    ((module.level_3_count + module.level_4_count + module.level_5_count) / totalComponents) * 100 : 0;

  const monetizationRate = totalComponents > 0 ? (module.level_5_count / totalComponents) * 100 : 0;

  return {
    integration_rate: Math.round(integrationRate),
    monetization_rate: Math.round(monetizationRate),
    stability_score: module.stability_score,
    monetization_readiness: module.monetization_readiness,
    health_grade: getHealthGrade(module.stability_score, module.monetization_readiness),
    critical_gaps_count: module.critical_gaps.length,
    readiness_level: getReadinessLevel(module)
  };
}

// Calculate metrics from component data (mock implementation)
async function calculateModuleMetrics(moduleName: string) {
  // This would normally:
  // 1. Query all components for this module
  // 2. Count integration levels
  // 3. Calculate stability and monetization readiness
  // 4. Identify critical gaps
  
  // For now, return mock data
  return {
    level_0_count: Math.floor(Math.random() * 3),
    level_1_count: Math.floor(Math.random() * 3),
    level_2_count: Math.floor(Math.random() * 3),
    level_3_count: Math.floor(Math.random() * 2),
    level_4_count: Math.floor(Math.random() * 2),
    level_5_count: Math.floor(Math.random() * 2),
    stability_score: Math.floor(Math.random() * 10),
    monetization_readiness: Math.floor(Math.random() * 10),
    critical_gaps: ['Sample gap 1', 'Sample gap 2']
  };
}

function getHealthGrade(stability: number, monetization: number): string {
  const average = (stability + monetization) / 2;
  
  if (average >= 9) return 'A+';
  if (average >= 8) return 'A';
  if (average >= 7) return 'B';
  if (average >= 6) return 'C';
  if (average >= 5) return 'D';
  return 'F';
}

function getReadinessLevel(module: Module): string {
  if (module.level_5_count >= 3 && module.monetization_readiness >= 8) return 'Launch Ready';
  if (module.level_3_count >= 2 && module.stability_score >= 7) return 'Demo Ready';
  if (module.level_2_count >= 1) return 'Integration Ready';
  if (module.level_1_count >= 1) return 'Development';
  return 'Concept';
}
