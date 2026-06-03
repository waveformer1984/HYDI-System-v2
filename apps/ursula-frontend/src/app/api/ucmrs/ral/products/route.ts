import { NextRequest, NextResponse } from 'next/server';
import { ProductCandidate, CreateProductRequest, UpdateProductRequest } from '@/lib/ucmrs/types-ral';
import { Component } from '@/lib/ucmrs/types';

// Mock database - replace with actual DB connection
let products: ProductCandidate[] = [];
let nextId = 1;

// GET /api/ucmrs/ral/products - List product candidates
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const moduleId = searchParams.get('moduleId');

  let filteredProducts = products;

  if (status) {
    filteredProducts = filteredProducts.filter(p => p.status === status);
  }

  if (moduleId) {
    filteredProducts = filteredProducts.filter(p => p.source_module === moduleId);
  }

  return NextResponse.json({ products: filteredProducts });
}

// POST /api/ucmrs/ral/products/collapse - Component -> Product collapse logic
export async function POST_COLLAPSE(request: NextRequest) {
  try {
    const body = await request.json();
    const { module_name, components, core_function, target_user, problem_solved, demo_method } = body;

    if (!module_name || !components || !core_function || !target_user || !problem_solved || !demo_method) {
      return NextResponse.json(
        { error: 'Missing required fields for product collapse' },
        { status: 400 }
      );
    }

    // Validate collapse criteria: 3+ components at Level 3+
    const mockComponents: Component[] = [
      {
        id: '1',
        component_id: 'LASER_HARP_01',
        module_name,
        ursula_status: 'Controlled',
        // ... other fields
      } as Component
    ];

    const level3PlusComponents = mockComponents.filter(c => {
      const level = getIntegrationLevel(c.ursula_status);
      return level >= 3;
    });

    if (level3PlusComponents.length < 3) {
      return NextResponse.json(
        { error: `Need 3+ Level 3+ components, only have ${level3PlusComponents.length}` },
        { status: 400 }
      );
    }

    // Generate product ID
    const productId = generateProductId(module_name);

    // Determine price tier based on complexity
    const priceTier = determinePriceTier(level3PlusComponents.length);
    
    // Determine revenue model based on category
    const revenueModel = determineRevenueModel(module_name);

    const newProduct: ProductCandidate = {
      id: (nextId++).toString(),
      product_id: productId,
      core_function,
      target_user,
      problem_solved,
      included_components: components,
      demo_method,
      price_tier: priceTier,
      revenue_model: revenueModel,
      status: 'Candidate',
      time_to_first_dollar: 30, // Default target
      total_revenue: 0,
      units_sold: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_module: module_name
    };

    products.push(newProduct);

    return NextResponse.json({
      product: newProduct,
      message: 'Product candidate created. Now build the demo.',
      next_action: 'BUILD_DEMO',
      urgency: 'High'
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// POST /api/ucmrs/ral/products - Create product directly
export async function POST(request: NextRequest) {
  try {
    const body: CreateProductRequest = await request.json();

    if (!body.product_id || !body.core_function || !body.target_user || !body.problem_solved || !body.included_components.length) {
      return NextResponse.json(
        { error: 'Missing required fields: product_id, core_function, target_user, problem_solved, included_components' },
        { status: 400 }
      );
    }

    // Check for duplicate product_id
    if (products.find(p => p.product_id === body.product_id)) {
      return NextResponse.json(
        { error: 'Product ID already exists' },
        { status: 409 }
      );
    }

    const newProduct: ProductCandidate = {
      id: (nextId++).toString(),
      product_id: body.product_id,
      core_function: body.core_function,
      target_user: body.target_user,
      problem_solved: body.problem_solved,
      included_components: body.included_components,
      demo_method: body.demo_method || 'Not defined',
      price_tier: body.price_tier,
      revenue_model: body.revenue_model,
      status: 'Candidate',
      time_to_first_dollar: 30,
      total_revenue: 0,
      units_sold: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_module: 'Manual'
    };

    products.push(newProduct);

    return NextResponse.json({
      product: newProduct,
      message: 'Product created. Begin development sequence.'
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/ral/products - Update product status (id in body)
export async function PUT(request: NextRequest) {
  try {
    const body: UpdateProductRequest & { id: string } = await request.json();
    const productIndex = products.findIndex(p => p.id === body.id);

    if (productIndex === -1) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const product = products[productIndex];
    const previousStatus = product.status;

    // Update product
    const updatedProduct = {
      ...product,
      ...body,
      updated_at: new Date().toISOString()
    };

    // Track first dollar achievement
    if (body.total_revenue && body.total_revenue > 0 && !product.actual_first_dollar_days) {
      const daysToFirstDollar = Math.floor((new Date().getTime() - new Date(product.created_at).getTime()) / (1000 * 60 * 60 * 24));
      updatedProduct.actual_first_dollar_days = daysToFirstDollar;
    }

    products[productIndex] = updatedProduct;

    // Generate next action based on status change
    const nextAction = generateNextAction(updatedProduct.status, previousStatus);

    return NextResponse.json({
      product: updatedProduct,
      next_action: nextAction,
      message: `Product status updated to ${updatedProduct.status}`
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/ral/products/prescriptive - Get prescriptive actions (id in query)
export async function GET_PRESCRIPTIVE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const product = products.find(p => p.id === id);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const prescriptive = generatePrescriptiveActions(product);

  return NextResponse.json({
    product_id: product.product_id,
    current_status: product.status,
    prescriptive_actions: prescriptive.actions,
    brutal_assessment: prescriptive.assessment,
    deadline: prescriptive.deadline,
    consequence: prescriptive.consequence
  });
}

// GET /api/ucmrs/ral/products/candidates - Analyze modules for product potential
export async function GET_CANDIDATES(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const minComponents = parseInt(searchParams.get('minComponents') || '3');

  // Mock module analysis - replace with actual component queries
  const moduleCandidates = [
    {
      module_name: 'Laser Harp System',
      total_components: 5,
      level_3_plus_components: 3,
      collapse_ready: true,
      suggested_product: {
        core_function: 'MIDI laser harp controller',
        target_user: 'Electronic musicians',
        problem_solved: 'Expressive MIDI control without touching',
        demo_method: 'Play melody by breaking laser beams',
        price_tier: '$$',
        revenue_model: 'One-time'
      }
    },
    {
      module_name: 'Gesture Control',
      total_components: 4,
      level_3_plus_components: 2,
      collapse_ready: false,
      missing_components: 1,
      suggested_product: null
    }
  ];

  const readyModules = moduleCandidates.filter(m => m.collapse_ready && m.level_3_plus_components >= minComponents);

  return NextResponse.json({
    candidates: readyModules,
    total_modules_analyzed: moduleCandidates.length,
    ready_for_collapse: readyModules.length,
    recommendation: readyModules.length > 0 ? 
      `Collapse ${readyModules[0].module_name} immediately` : 
      'Need more Level 3+ components for product collapse'
  });
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

function generateProductId(moduleName: string): string {
  const cleanName = moduleName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const timestamp = Date.now().toString(36);
  return `${cleanName}_${timestamp}`;
}

function determinePriceTier(componentCount: number): '$' | '$$' | '$$$' {
  if (componentCount <= 3) return '$';
  if (componentCount <= 5) return '$$';
  return '$$$';
}

function determineRevenueModel(moduleName: string): 'One-time' | 'Subscription' | 'Hybrid' {
  if (moduleName.toLowerCase().includes('audio') || moduleName.toLowerCase().includes('synth')) {
    return 'One-time';
  }
  if (moduleName.toLowerCase().includes('ursula') || moduleName.toLowerCase().includes('control')) {
    return 'Subscription';
  }
  return 'Hybrid';
}

function generateNextAction(newStatus: string, previousStatus: string): string {
  const statusActions: Record<string, string> = {
    'Candidate': 'Build demo immediately',
    'In Development': 'Complete development tasks',
    'Demo Ready': 'Assign price tier',
    'Priced': 'Generate offer page',
    'Offer Page': 'Test sales - attempt 10 sales',
    'Testing Sales': 'Analyze results and scale',
    'Live': 'Monitor and optimize',
    'Killed': 'Archive and document lessons'
  };

  return statusActions[newStatus] || 'Continue development';
}

function generatePrescriptiveActions(product: ProductCandidate) {
  const actions = [];
  let assessment = '';
  let deadline = '';
  let consequence = '';

  switch (product.status) {
    case 'Candidate':
      actions.push('Build 60-second demo this week');
      actions.push('Record demo video');
      actions.push('Test demo with 3 people');
      assessment = 'Product exists only on paper';
      deadline = '7 days to demo';
      consequence = 'Moves to R&D purgatory';
      break;

    case 'Demo Ready':
      actions.push('Set price tier based on complexity');
      actions.push('Research competitor pricing');
      actions.push('Define revenue model');
      assessment = 'Demo exists but no price';
      deadline = '3 days to price';
      consequence = 'No revenue path = hobby project';
      break;

    case 'Priced':
      actions.push('Create simple landing page');
      actions.push('Add payment integration');
      actions.push('Write product description');
      assessment = 'Priced but not buyable';
      deadline = '5 days to offer page';
      consequence = 'Price without purchase = delusion';
      break;

    case 'Offer Page':
      actions.push('Attempt 10 sales this week');
      actions.push('Track conversion rate');
      actions.push('Document objections');
      assessment = 'Buyable but untested';
      deadline = '7 days to first sale';
      consequence = 'No sales = not a product';
      break;

    case 'Testing Sales':
      if (product.units_sold === 0) {
        actions.push('Analyze why no sales');
        actions.push('Pivot or kill product');
        actions.push('Test new positioning');
        assessment = 'Market rejection detected';
        deadline = '3 days to pivot';
        consequence = 'Continued failure = kill product';
      } else {
        actions.push('Scale successful approach');
        actions.push('Optimize conversion');
        actions.push('Expand marketing');
        assessment = 'Product validation achieved';
        deadline = '30 days to scale';
        consequence = 'Scale or stagnate';
      }
      break;

    default:
      actions.push('Evaluate product viability');
      assessment = 'Status unclear';
      deadline = 'Immediate decision needed';
      consequence = 'Indecision wastes resources';
  }

  return { actions, assessment, deadline, consequence };
}
