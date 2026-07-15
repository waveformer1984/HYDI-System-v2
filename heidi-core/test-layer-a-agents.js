#!/usr/bin/env node
/**
 * Layer A Agent Tests
 *
 * Verify that ArchitectAgent, EnergyAgent, and AISystemsAgent
 * compute transparent, input-driven outputs (not canned returns).
 */

const {
  ArchitectAgent,
  EnergyAgent,
  AISystemsAgent
} = require('./phase-5-complete-agents');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

function log(color, ...args) {
  console.log(color + args.join(' ') + colors.reset);
}

function assert(condition, message) {
  if (!condition) {
    log(colors.red, `❌ FAIL: ${message}`);
    process.exit(1);
  }
  log(colors.green, `✅ ${message}`);
}

async function testArchitectDesignSystem() {
  log(colors.blue, '\n=== ArchitectAgent.designSystem ===');

  const architect = new ArchitectAgent();

  // Test 1: Simple system with stateless + caching
  const result1 = await architect.designSystem({
    type: 'system-design',
    requirements: {
      components: ['api', 'cache'],
      integrations: ['redis'],
      patterns: ['stateless', 'caching'],
      expected_rps: 1000
    }
  });
  assert(result1.success === true, 'Returns success: true');
  assert(result1.design.scalability_rating > 0.7,
    'Stateless + caching scores high scalability (>0.7)');
  assert(result1.design.integration_complexity === 'low',
    'Few integrations is low complexity');
  assert(result1.design.estimated_implementation_days <= 9,
    'Simple system takes ≤9 days');

  // Test 2: Complex monolith (low scalability)
  const result2 = await architect.designSystem({
    type: 'system-design',
    requirements: {
      components: ['api', 'db', 'cache', 'queue', 'auth', 'billing'],
      integrations: ['stripe', 'aws', 'postgres', 'redis', 'kafka'],
      patterns: ['monolith', 'shared-database'],
      expected_rps: 5000
    }
  });
  assert(result2.design.scalability_rating < 0.5,
    'Monolith scores low scalability (<0.5)');
  assert(result2.design.integration_complexity === 'high',
    'Many integrations is high complexity');
  assert(result2.design.estimated_implementation_days > 20,
    'Complex system takes >20 days');

  // Test 3: Invalid input (empty components)
  const result3 = await architect.designSystem({
    type: 'system-design',
    requirements: { components: [] }
  });
  assert(result3.success === false && result3.error,
    'Rejects empty components array');
}

async function testArchitectPlanResources() {
  log(colors.blue, '\n=== ArchitectAgent.planResources ===');

  const architect = new ArchitectAgent();

  // Test 1: Simple 2-component project
  const result1 = await architect.planResources({
    type: 'resource-planning',
    requirements: {
      components: [{ name: 'frontend' }, { name: 'api' }],
      complexity: 'low',
      target_weeks: 2
    }
  });
  assert(result1.success === true, 'Returns success: true');
  assert(result1.plan.team_size >= 1, 'Simple project needs ≥1 engineer');
  assert(result1.plan.budget_usd > 0, 'Budget is positive');

  // Test 2: Complex 4-component project
  const result2 = await architect.planResources({
    type: 'resource-planning',
    requirements: {
      components: [
        { name: 'frontend' },
        { name: 'api' },
        { name: 'database' },
        { name: 'infrastructure' }
      ],
      complexity: 'high',
      target_weeks: 2
    }
  });
  assert(result2.plan.team_size > result1.plan.team_size,
    'Complex project needs more engineers');
  assert(result2.plan.budget_usd > result1.plan.budget_usd,
    'Complex project costs more');

  // Test 3: Invalid complexity
  const result3 = await architect.planResources({
    type: 'resource-planning',
    requirements: {
      components: [{ name: 'api' }],
      complexity: 'invalid'
    }
  });
  assert(result3.plan.team_size > 0,
    'Defaults to medium complexity gracefully');
}

async function testEnergyReduceCosts() {
  log(colors.blue, '\n=== EnergyAgent.reduceCosts ===');

  const energy = new EnergyAgent();

  // Test 1: Realistic cost reduction (consolidation + automation)
  const result1 = await energy.reduceCosts({
    type: 'cost-reduction',
    current_monthly_cost: 1500,
    initiatives: ['consolidation', 'automation']
  });
  assert(result1.success === true, 'Returns success: true');
  assert(result1.savings.target_monthly_cost < result1.savings.current_monthly_cost,
    'Target cost < current cost');
  assert(result1.savings.savings_percent > 0,
    'Savings percent is positive');
  assert(result1.savings.savings_percent < 30,
    'Savings percent is realistic');

  // Test 2: More initiatives yield more savings
  const result2 = await energy.reduceCosts({
    type: 'cost-reduction',
    current_monthly_cost: 1500,
    initiatives: ['consolidation', 'automation', 'vendor negotiation', 'rightsizing']
  });
  assert(result2.savings.savings_percent > result1.savings.savings_percent,
    'More initiatives → more savings');
}

async function testEnergyPlanCapacity() {
  log(colors.blue, '\n=== EnergyAgent.planCapacity ===');

  const energy = new EnergyAgent();

  // Test 1: Low utilization, sustainable
  const result1 = await energy.planCapacity({
    type: 'capacity-planning',
    current_utilization: 0.3,
    monthly_growth_rate: 0.05,
    horizon_months: 6
  });
  assert(result1.success === true, 'Returns success: true');
  assert(result1.capacity.expansion_needed === false,
    'Low util + moderate growth doesn\'t need expansion');
  assert(result1.capacity['forecast_6_months'] > 0.3,
    'Utilization increases over time');

  // Test 2: High utilization + rapid growth needs expansion
  const result2 = await energy.planCapacity({
    type: 'capacity-planning',
    current_utilization: 0.7,
    monthly_growth_rate: 0.15,
    horizon_months: 6
  });
  assert(result2.capacity.expansion_needed === true,
    'High util + rapid growth needs expansion');
}

async function testAISystemsSelectModel() {
  log(colors.blue, '\n=== AISystemsAgent.selectModel ===');

  const ai = new AISystemsAgent();

  // Test 1: Tight latency → selects haiku
  const result1 = await ai.selectModel({
    type: 'model-selection',
    max_latency_ms: 300,
    min_accuracy: 0.85
  });
  assert(result1.success === true, 'Returns success: true');
  assert(result1.model_recommendation.model_name === 'claude-haiku-4-5',
    'Max latency 300ms picks haiku');

  // Test 2: High accuracy → avoids haiku (picks sonnet or opus)
  const result2 = await ai.selectModel({
    type: 'model-selection',
    max_latency_ms: 5000,
    min_accuracy: 0.93
  });
  assert(result2.success === true, 'Returns success: true');
  assert(result2.model_recommendation.model_name !== 'claude-haiku-4-5',
    'Min accuracy 0.93 avoids haiku (accuracy 0.88)');

  // Test 3: Impossible constraints
  const result3 = await ai.selectModel({
    type: 'model-selection',
    max_latency_ms: 50,
    min_accuracy: 0.99
  });
  assert(result3.success === false,
    'Rejects impossible constraints');
}

// Run all tests
async function main() {
  log(colors.yellow, '\n╔════════════════════════════════════════╗');
  log(colors.yellow, '║  LAYER A AGENT TEST SUITE              ║');
  log(colors.yellow, '╚════════════════════════════════════════╝');

  try {
    await testArchitectDesignSystem();
    await testArchitectPlanResources();
    await testEnergyReduceCosts();
    await testEnergyPlanCapacity();
    await testAISystemsSelectModel();

    log(colors.green, '\n╔════════════════════════════════════════╗');
    log(colors.green, '║  ✅ ALL TESTS PASSED                   ║');
    log(colors.green, '╚════════════════════════════════════════╝\n');
    process.exit(0);
  } catch (error) {
    log(colors.red, '\n❌ TEST SUITE FAILED:', error.message);
    process.exit(1);
  }
}

main();
