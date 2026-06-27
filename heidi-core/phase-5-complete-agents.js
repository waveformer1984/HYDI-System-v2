/**
 * Phase 5: Complete 15-Agent Layer Implementation
 *
 * All agents extend from a base class with standard interfaces:
 * - initialize()
 * - canExecute(task)
 * - execute(task)
 * - reflect()
 *
 * Organized in 5 Layers:
 * Layer A: Strategic (Architect, Energy, AI Systems)
 * Layer B: Execution (Procurement, Construction, Fabrication)
 * Layer C: Finance (Finance, Funding, Revenue)
 * Layer D: Outreach (Outreach, Marketing, Community)
 * Layer E: Facility (Facility, Security, Workflow)
 */

// --- shared numeric helpers (used by the heuristic agent logic below) ---
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Base Agent Class
 */
class HeidiAgent {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.layer = config.layer;
    this.division = config.division;
    this.capabilities = config.capabilities || [];
    this.supabase = config.supabase;
    this.logger = config.logger;
  }

  async initialize() {
    this.logger?.log(`[${this.name}] Initialized`);
  }

  canExecute(task) {
    return this.capabilities.includes(task.type);
  }

  async execute(task) {
    throw new Error('execute() must be implemented');
  }

  async reflect() {
    // Optional: analyze recent decisions and update learning
  }
}

// ============================================================================
// LAYER A: STRATEGIC
// ============================================================================

class ArchitectAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'arch-agent', name: 'Architect Agent', layer: 'A' });
    this.capabilities = ['system-design', 'resource-planning', 'risk-assessment'];
  }

  async execute(task) {
    switch (task.type) {
      case 'system-design':
        return await this.designSystem(task);
      case 'resource-planning':
        return await this.planResources(task);
      case 'risk-assessment':
        return await this.assessRisks(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  // Heuristic system design: derives complexity/scalability/effort from the
  // actual component + integration surface and declared architecture patterns.
  async designSystem(task) {
    const req = task.requirements || {};
    const components = Array.isArray(req.components) ? req.components : [];
    if (components.length === 0) {
      return { success: false, error: 'designSystem requires requirements.components[] (non-empty)' };
    }
    const integrations = Array.isArray(req.integrations) ? req.integrations : [];
    const expectedRps = Number(req.expected_rps) || 0;
    const patterns = (Array.isArray(req.patterns) ? req.patterns : []).map(p => String(p).toLowerCase());

    const surface = components.length + integrations.length;
    const integration_complexity = surface <= 4 ? 'low' : surface <= 9 ? 'medium' : 'high';

    // Scalability: baseline adjusted by known good/bad patterns and load pressure.
    let scalability = 0.6;
    if (patterns.includes('stateless')) scalability += 0.12;
    if (patterns.some(p => p.includes('horizontal') || p.includes('autoscal'))) scalability += 0.12;
    if (patterns.includes('caching')) scalability += 0.06;
    if (patterns.some(p => p.includes('monolith') || p.includes('shared-database'))) scalability -= 0.15;
    if (expectedRps > 1000 && !patterns.some(p => p.includes('scal'))) scalability -= 0.1;
    scalability = clamp(scalability, 0.1, 0.99);

    const complexityMult = integration_complexity === 'high' ? 1.6 : integration_complexity === 'medium' ? 1.25 : 1.0;
    const estimated_implementation_days = Math.ceil(components.length * 3 * complexityMult + integrations.length * 2);

    return {
      success: true,
      design: {
        components,
        integration_points: integrations.length,
        scalability_rating: round2(scalability),
        integration_complexity,
        estimated_implementation_days,
        method: 'surface-area + pattern heuristic'
      }
    };
  }

  // Effort-based resource plan: sizes team/budget/timeline from component count
  // and complexity, honoring a target deadline when one is supplied.
  async planResources(task) {
    const req = task.requirements || {};
    const components = Array.isArray(req.components) ? req.components : [];
    if (components.length === 0) {
      return { success: false, error: 'planResources requires requirements.components[] (non-empty)' };
    }
    const complexity = ['low', 'medium', 'high'].includes(req.complexity) ? req.complexity : 'medium';
    const blendedDayRate = Number(req.blended_day_rate_usd) || 800;
    const complexityMult = complexity === 'high' ? 1.6 : complexity === 'medium' ? 1.25 : 1.0;

    const personDays = Math.ceil(components.length * 3 * complexityMult);
    const targetWeeks = Number(req.target_weeks) || 0;
    const team_size = targetWeeks > 0
      ? Math.min(8, Math.max(1, Math.ceil(personDays / (targetWeeks * 5))))
      : Math.min(6, Math.max(1, Math.ceil(components.length / 3)));
    const timeline_weeks = Math.max(1, Math.ceil(personDays / (team_size * 5)));
    const budget_usd = personDays * blendedDayRate;

    return {
      success: true,
      plan: {
        team_size,
        budget_usd,
        timeline_weeks,
        person_days: personDays,
        critical_path: Array.isArray(req.phases) && req.phases.length ? req.phases : ['infrastructure', 'integration', 'testing'],
        assumptions: { blended_day_rate_usd: blendedDayRate, productive_days_per_week: 5 }
      }
    };
  }

  // Factor-based risk assessment: emits risks only for conditions present in the
  // input (integrations, novel tech, schedule pressure) and aggregates a score.
  async assessRisks(task) {
    const req = task.requirements || {};
    const components = Array.isArray(req.components) ? req.components : [];
    const integrations = Array.isArray(req.integrations) ? req.integrations : [];
    const newTech = Array.isArray(req.new_technologies) ? req.new_technologies : [];
    const targetWeeks = Number(req.target_weeks) || 0;
    const personDays = Math.ceil((components.length || 1) * 3 * 1.25);

    const risks = [];
    if (integrations.length > 0) {
      const p = clamp(0.15 + integrations.length * 0.08, 0.1, 0.9);
      risks.push({ risk: 'Integration complexity', probability: round2(p), impact: integrations.length > 4 ? 'high' : 'medium', mitigation: 'Early integration POC' });
    }
    if (newTech.length > 0) {
      const p = clamp(0.2 + newTech.length * 0.1, 0.1, 0.9);
      risks.push({ risk: 'Unproven technology', probability: round2(p), impact: 'high', mitigation: `Spike on: ${newTech.join(', ')}` });
    }
    if (targetWeeks > 0) {
      const impliedWeeks = personDays / (4 * 5); // assume ~4-person team
      if (targetWeeks < impliedWeeks) {
        const p = clamp((impliedWeeks - targetWeeks) / impliedWeeks, 0.2, 0.95);
        risks.push({ risk: 'Schedule pressure', probability: round2(p), impact: 'high', mitigation: 'Cut scope or add staff' });
      }
    }
    if (risks.length === 0) {
      risks.push({ risk: 'Baseline execution risk', probability: 0.15, impact: 'low', mitigation: 'Standard reviews' });
    }

    const impactWeight = { low: 0.3, medium: 0.6, high: 1.0 };
    const overall = risks.reduce((s, r) => s + r.probability * impactWeight[r.impact], 0) / risks.length;

    return {
      success: true,
      risks,
      overall_risk_score: round2(clamp(overall, 0, 1)),
      method: 'factor-based aggregation'
    };
  }
}

class EnergyAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'energy-agent', name: 'Energy Agent', layer: 'A' });
    this.capabilities = ['capacity-planning', 'efficiency-optimization', 'cost-reduction'];
  }

  async execute(task) {
    switch (task.type) {
      case 'capacity-planning':
        return await this.planCapacity(task);
      case 'efficiency-optimization':
        return await this.optimizeEfficiency(task);
      case 'cost-reduction':
        return await this.reduceCosts(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  // Compound-growth capacity forecast from current utilization + growth rate.
  async planCapacity(task) {
    const c = task.capacity || task;
    const current = Number(c.current_utilization);
    if (!(current >= 0 && current <= 1)) {
      return { success: false, error: 'planCapacity requires capacity.current_utilization in [0,1]' };
    }
    const monthlyGrowth = Number(c.monthly_growth_rate) || 0.05;
    const months = Number(c.horizon_months) || 3;
    const headroom_required = 0.15;
    const forecast = current * Math.pow(1 + monthlyGrowth, months);
    const expansion_needed = forecast + headroom_required > 1;

    return {
      success: true,
      capacity: {
        current_utilization: round2(current),
        [`forecast_${months}_months`]: round2(Math.min(forecast, 2)),
        headroom_required,
        expansion_needed,
        recommended_additions: expansion_needed ? (c.resource_types || ['compute', 'storage']) : [],
        assumptions: { monthly_growth_rate: monthlyGrowth, horizon_months: months }
      }
    };
  }

  // Efficiency gains from applied techniques, with diminishing returns.
  async optimizeEfficiency(task) {
    const current = Number(task.current_efficiency);
    if (!(current >= 0 && current <= 1)) {
      return { success: false, error: 'optimizeEfficiency requires current_efficiency in [0,1]' };
    }
    const GAINS = { 'parallel processing': 0.08, 'caching': 0.06, 'batch optimization': 0.05, 'indexing': 0.05, 'compression': 0.03 };
    const applied = Array.isArray(task.techniques) ? task.techniques : Object.keys(GAINS);
    let target = current;
    let factor = 1;
    for (const t of applied) {
      target += (GAINS[String(t).toLowerCase()] || 0.02) * factor;
      factor *= 0.7; // each successive technique contributes less
    }
    target = clamp(target, current, 0.98);

    return {
      success: true,
      optimization: {
        current_efficiency: round2(current),
        target_efficiency: round2(target),
        improvements: applied,
        estimated_speedup: round2(current > 0 ? target / current : 1)
      }
    };
  }

  // Compounding cost reduction: each initiative applies to the remaining cost.
  async reduceCosts(task) {
    const current = Number(task.current_monthly_cost);
    if (!(current > 0)) {
      return { success: false, error: 'reduceCosts requires current_monthly_cost > 0' };
    }
    const RATES = { consolidation: 0.10, automation: 0.08, 'vendor negotiation': 0.07, rightsizing: 0.12, 'reserved capacity': 0.15 };
    const initiatives = Array.isArray(task.initiatives) ? task.initiatives : Object.keys(RATES).slice(0, 3);
    let target = current;
    for (const i of initiatives) {
      target *= (1 - (RATES[String(i).toLowerCase()] || 0.03));
    }

    return {
      success: true,
      savings: {
        current_monthly_cost: round2(current),
        target_monthly_cost: round2(target),
        monthly_savings: round2(current - target),
        savings_percent: round2((1 - target / current) * 100),
        initiatives
      }
    };
  }
}

class AISystemsAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'ai-agent', name: 'AI Systems Agent', layer: 'A' });
    this.capabilities = ['model-selection', 'training-optimization', 'deployment'];
  }

  async execute(task) {
    switch (task.type) {
      case 'model-selection':
        return await this.selectModel(task);
      case 'training-optimization':
        return await this.optimizeTraining(task);
      case 'deployment':
        return await this.deployModel(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  // Constraint-based selection over a small catalog. Picks the eligible model
  // with the best quality, breaking ties on cost. (accuracy = relative quality
  // proxy, not a guarantee.)
  async selectModel(task) {
    const useCase = task.use_case || 'general';
    const maxLatencyMs = Number(task.max_latency_ms) || Infinity;
    const minAccuracy = Number(task.min_accuracy) || 0;
    const maxCostPer1k = Number(task.max_cost_per_1k_tokens) || Infinity;

    const CATALOG = [
      { model_name: 'claude-opus-4-8', accuracy: 0.96, latency_ms: 900, cost_per_1k_tokens: 0.03 },
      { model_name: 'claude-sonnet-4-6', accuracy: 0.93, latency_ms: 500, cost_per_1k_tokens: 0.011 },
      { model_name: 'claude-haiku-4-5', accuracy: 0.88, latency_ms: 200, cost_per_1k_tokens: 0.004 }
    ];
    const eligible = CATALOG.filter(m =>
      m.latency_ms <= maxLatencyMs && m.accuracy >= minAccuracy && m.cost_per_1k_tokens <= maxCostPer1k);
    if (eligible.length === 0) {
      return { success: false, error: 'No catalog model meets the given latency/accuracy/cost constraints', constraints: { maxLatencyMs, minAccuracy, maxCostPer1k } };
    }
    eligible.sort((a, b) => b.accuracy - a.accuracy || a.cost_per_1k_tokens - b.cost_per_1k_tokens);
    const pick = eligible[0];

    return {
      success: true,
      model_recommendation: {
        model_name: pick.model_name,
        use_case: useCase,
        accuracy_estimate: pick.accuracy,
        latency_ms: pick.latency_ms,
        cost_per_1k_tokens: pick.cost_per_1k_tokens,
        alternatives: eligible.slice(1).map(m => m.model_name)
      }
    };
  }

  // Starting hyperparameters derived from dataset size and target accuracy.
  async optimizeTraining(task) {
    const datasetSize = Number(task.dataset_size);
    if (!(datasetSize > 0)) {
      return { success: false, error: 'optimizeTraining requires dataset_size > 0 (number of examples)' };
    }
    const targetAccuracy = clamp(Number(task.target_accuracy) || 0.9, 0.5, 0.99);
    const batch_size = Math.min(512, Math.max(8, 2 ** Math.round(Math.log2(Math.sqrt(datasetSize)))));
    const validation_split = datasetSize < 5000 ? 0.2 : 0.1;
    const baseEpochs = datasetSize < 1000 ? 40 : datasetSize < 10000 ? 25 : 12;
    const epochs = Math.round(baseEpochs * (0.5 + targetAccuracy));
    const learning_rate = batch_size >= 128 ? 0.003 : 0.001;

    return {
      success: true,
      optimization: {
        batch_size,
        learning_rate,
        epochs,
        validation_split,
        target_accuracy: targetAccuracy,
        note: 'starting hyperparameters; tune against a validation curve'
      }
    };
  }

  // Sizes replicas to expected load and builds an env-specific endpoint.
  // Does NOT actually deploy — returns a ready-to-deploy spec.
  async deployModel(task) {
    const modelName = task.model_name;
    if (!modelName) {
      return { success: false, error: 'deployModel requires model_name' };
    }
    const env = ['dev', 'staging', 'production'].includes(task.environment) ? task.environment : 'staging';
    const expectedRps = Number(task.expected_rps) || 50;
    const perReplicaRps = Number(task.per_replica_rps) || 40;
    const replicas = Math.max(env === 'production' ? 2 : 1, Math.ceil(expectedRps / perReplicaRps));
    const slug = String(modelName).toLowerCase().replace(/[^a-z0-9]+/g, '-');

    return {
      success: true,
      deployment: {
        endpoint: `https://${slug}.${env}.inference.internal`,
        version: task.version || '1.0.0',
        environment: env,
        replicas,
        provisioned_rps: replicas * perReplicaRps,
        status: 'ready-to-deploy'
      }
    };
  }
}

// ============================================================================
// LAYER B: EXECUTION
// ============================================================================

class ProcurementAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'proc-agent', name: 'Procurement Agent', layer: 'B' });
    this.capabilities = ['vendor-evaluation', 'negotiation', 'purchase-approval'];
  }

  async execute(task) {
    switch (task.type) {
      case 'vendor-evaluation':
        return await this.evaluateVendor(task);
      case 'negotiation':
        return await this.negotiate(task);
      case 'purchase-approval':
        return await this.approvePurchase(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async evaluateVendor(task) {
    const quote = Number(task.quote_amount) || 0;
    const historical_delivery_rate = Number(task.delivery_rate) || 0.85;
    const defect_rate = Number(task.defect_rate) || 0.02;

    if (quote <= 0) return { success: false, error: 'evaluateVendor requires quote_amount > 0' };

    const price_score = clamp(1 - (quote / 100000), 0.3, 1.0);
    const quality_score = round2((1 - defect_rate) * 0.95);
    const delivery_score = round2(historical_delivery_rate * 0.98);
    const overall = round2((price_score * 0.35 + quality_score * 0.35 + delivery_score * 0.30));

    return {
      success: true,
      evaluation: {
        vendor_name: task.vendor_name || 'Unknown',
        price_competitiveness: round2(price_score),
        quality_score,
        delivery_reliability: delivery_score,
        overall_score: overall,
        recommendation: overall >= 0.80 ? 'APPROVED' : overall >= 0.65 ? 'CONDITIONAL' : 'REJECTED'
      }
    };
  }

  async negotiate(task) {
    const initial = Number(task.initial_price);
    const budget = Number(task.budget_limit);
    if (!(initial > 0 && budget > 0)) {
      return { success: false, error: 'negotiate requires initial_price and budget_limit > 0' };
    }

    const max_discount = 0.25; // 25% max
    const target = budget;
    const achievable_price = Math.max(target, initial * (1 - max_discount));
    const discount_achieved = round2((1 - achievable_price / initial) * 100);

    return {
      success: true,
      negotiation: {
        initial_price: round2(initial),
        target_price: round2(target),
        negotiated_price: round2(achievable_price),
        discount_percent: discount_achieved,
        payment_terms: 'Net 30',
        achievable: achievable_price <= budget
      }
    };
  }

  async approvePurchase(task) {
    const amount = Number(task.amount);
    const delivery_days = Number(task.delivery_days) || 14;
    if (!(amount > 0)) return { success: false, error: 'approvePurchase requires amount > 0' };

    return {
      success: true,
      purchase: {
        po_number: `PO-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        vendor: task.vendor || 'TBD',
        amount_usd: round2(amount),
        status: 'approved',
        scheduled_delivery: new Date(Date.now() + delivery_days * 24 * 60 * 60 * 1000).toISOString()
      }
    };
  }
}

class ConstructionAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'const-agent', name: 'Construction Agent', layer: 'B' });
    this.capabilities = ['project-planning', 'build-management', 'quality-assurance'];
  }

  async execute(task) {
    switch (task.type) {
      case 'project-planning':
        return await this.planProject(task);
      case 'build-management':
        return await this.manageBuild(task);
      case 'quality-assurance':
        return await this.assureQuality(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async planProject(task) {
    const components = Number(task.components) || 1;
    const integrations = Number(task.integrations) || 0;
    const teams = Number(task.teams) || 1;

    const base_weeks = components * 2;
    const integration_weeks = integrations * 1.5;
    const parallelism_factor = Math.sqrt(teams);
    const duration_weeks = Math.ceil((base_weeks + integration_weeks) / parallelism_factor);

    const phases = ['planning', 'setup', 'implementation'];
    if (integrations > 0) phases.push('integration');
    phases.push('testing', 'deployment');

    return {
      success: true,
      plan: {
        phases,
        total_phases: phases.length,
        estimated_duration_weeks: duration_weeks,
        team_parallelism: round2(parallelism_factor),
        critical_path: phases[Math.floor(phases.length / 2)],
        assumptions: { days_per_week: 5, ramp_up_overhead: 0.2 }
      }
    };
  }

  async manageBuild(task) {
    const tasks_completed = Number(task.tasks_completed) || 0;
    const total_tasks = Number(task.total_tasks) || 1;
    const blockers_count = Number(task.blockers) || 0;

    if (total_tasks <= 0) return { success: false, error: 'manageBuild requires total_tasks > 0' };

    const completion = clamp(tasks_completed / total_tasks, 0, 1);
    const is_blocked = blockers_count > 0;
    const last_update_hours = Number(task.last_update_hours_ago) || 0;

    return {
      success: true,
      build_status: {
        completion_percent: round2(completion * 100),
        tasks_completed,
        total_tasks,
        blockers: blockers_count,
        is_blocked,
        health: !is_blocked && completion > 0.5 ? 'healthy' : is_blocked ? 'blocked' : 'in-progress',
        last_activity_hours_ago: last_update_hours,
        trend: completion > 0.7 ? 'accelerating' : completion > 0.3 ? 'steady' : 'ramping'
      }
    };
  }

  async assureQuality(task) {
    const tests_run = Number(task.tests_run) || 0;
    const tests_passed = Number(task.tests_passed) || 0;
    const critical_issues = Number(task.critical_issues) || 0;
    const approvals = Number(task.approvals_required) || 1;

    const coverage = tests_run > 0 ? round2(tests_passed / tests_run) : 0;
    const pass_rate = tests_run > 0 ? round2(tests_passed / tests_run * 100) : 100;
    const quality_score = round2(Math.max(0, coverage * 0.7 - (critical_issues * 0.05)));

    return {
      success: true,
      quality: {
        test_coverage: coverage,
        pass_rate: round2(pass_rate),
        failed_tests: tests_run - tests_passed,
        critical_issues,
        code_review_approvals: Math.min(approvals, 3),
        quality_gate: critical_issues === 0 && coverage >= 0.8 ? 'PASSED' : critical_issues > 2 ? 'FAILED' : 'CONDITIONAL',
        quality_score
      }
    };
  }
}

class FabricationAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'fab-agent', name: 'Fabrication Agent', layer: 'B' });
    this.capabilities = ['design-review', 'prototype-creation', 'production-planning'];
  }

  async execute(task) {
    switch (task.type) {
      case 'design-review':
        return await this.reviewDesign(task);
      case 'prototype-creation':
        return await this.createPrototype(task);
      case 'production-planning':
        return await this.planProduction(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async reviewDesign(task) {
    const parts = Number(task.part_count) || 1;
    const wall_thickness_mm = Number(task.wall_thickness_mm) || 2;
    const material_cost = Number(task.estimated_material_cost) || 0;

    const parts_penalty = Math.min(parts / 50, 0.2);
    const wall_score = wall_thickness_mm >= 1.5 ? 0.9 : 0.7;
    const feasibility = round2(0.95 - parts_penalty);
    const manufacturability = round2(wall_score * 0.98);
    const cost_optimization = material_cost > 100 ? 0.7 : material_cost > 50 ? 0.85 : 0.95;

    return {
      success: true,
      design_review: {
        design_feasibility: feasibility,
        manufacturability,
        cost_optimization: round2(cost_optimization),
        part_count: parts,
        recommendations: parts > 10 ? ['consolidate parts'] : [],
        approved: feasibility >= 0.85 && manufacturability >= 0.80
      }
    };
  }

  async createPrototype(task) {
    const iterations = Number(task.iterations) || 1;
    const time_per_iteration_hours = Number(task.time_per_iteration_hours) || 4;
    const material_cost_per = Number(task.material_cost_per_iteration) || 30;

    const total_time = iterations * time_per_iteration_hours;
    const total_material = iterations * material_cost_per;
    const quality_base = 0.70;
    const quality_improvement_per_iteration = 0.08;
    const final_quality = round2(Math.min(quality_base + (iterations - 1) * quality_improvement_per_iteration, 0.96));

    return {
      success: true,
      prototype: {
        status: iterations < 2 ? 'in-progress' : 'completed',
        iterations_completed: iterations,
        total_print_time_hours: round2(total_time),
        total_material_cost_usd: round2(total_material),
        quality_score: final_quality,
        iterations_remaining_estimate: Math.max(0, 3 - iterations)
      }
    };
  }

  async planProduction(task) {
    const setup_cost = Number(task.setup_cost) || 2000;
    const material_per_unit = Number(task.material_per_unit) || 15;
    const labor_per_unit = Number(task.labor_per_unit) || 8;
    const monthly_volume = Number(task.target_monthly_volume) || 100;

    const unit_cost = round2(material_per_unit + labor_per_unit);
    const monthly_production_cost = round2(unit_cost * monthly_volume);
    const capacity_per_month = Math.floor(monthly_volume * 1.2);
    const lead_time_days = Math.ceil(30 / (capacity_per_month / monthly_volume));

    return {
      success: true,
      production_plan: {
        unit_cost_usd: unit_cost,
        monthly_volume: monthly_volume,
        production_capacity_per_month: capacity_per_month,
        lead_time_days,
        quality_target_percent: 98,
        monthly_production_cost,
        break_even_units: Math.ceil(setup_cost / (unit_cost * 0.3)),
        payback_months: Math.ceil(setup_cost / (monthly_volume * unit_cost * 0.2))
      }
    };
  }
}

// ============================================================================
// LAYER C: FINANCE
// ============================================================================

class FinanceAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'fin-agent', name: 'Finance Agent', layer: 'C' });
    this.capabilities = ['budget-management', 'expense-tracking', 'financial-reporting'];
  }

  async execute(task) {
    switch (task.type) {
      case 'budget-management':
        return await this.manageBudget(task);
      case 'expense-tracking':
        return await this.trackExpenses(task);
      case 'financial-reporting':
        return await this.generateReport(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async manageBudget(task) {
    const total_budget = Number(task.total_budget) || 100000;
    const allocated = Number(task.allocated) || 0;
    if (total_budget <= 0) return { success: false, error: 'manageBudget requires total_budget > 0' };

    const available = Math.max(0, total_budget - allocated);
    const utilization = round2(allocated / total_budget * 100);
    const burn_rate = Number(task.monthly_burn) || 0;
    const months_remaining = burn_rate > 0 ? Math.ceil(available / burn_rate) : -1;

    return {
      success: true,
      budget_status: {
        total_budget: round2(total_budget),
        allocated,
        available: round2(available),
        utilization_percent: utilization,
        monthly_burn_rate: burn_rate,
        runway_months: months_remaining,
        budget_health: utilization >= 90 ? 'critical' : utilization >= 75 ? 'warning' : 'healthy'
      }
    };
  }

  async trackExpenses(task) {
    const expenses = Array.isArray(task.expenses) ? task.expenses : [];
    const budget_category = task.category || 'uncategorized';
    const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const categories = {};
    expenses.forEach(e => {
      const cat = e.category || 'other';
      categories[cat] = (categories[cat] || 0) + Number(e.amount || 0);
    });

    return {
      success: true,
      expense_tracking: {
        month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
        total_expenses: round2(total),
        expense_count: expenses.length,
        by_category: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, round2(v)])),
        average_expense: expenses.length > 0 ? round2(total / expenses.length) : 0
      }
    };
  }

  async generateReport(task) {
    const revenue = Number(task.revenue) || 0;
    const expenses = Number(task.expenses) || 0;
    const period = task.period || 'monthly';

    const net_income = revenue - expenses;
    const margin = revenue > 0 ? round2((net_income / revenue) * 100) : 0;
    const profit_status = net_income > 0 ? 'profitable' : net_income === 0 ? 'breakeven' : 'loss';

    return {
      success: true,
      financial_report: {
        period,
        revenue: round2(revenue),
        expenses: round2(expenses),
        net_income: round2(net_income),
        profit_margin_percent: margin,
        profit_status,
        trend: Number(task.prior_net_income || 0) > 0 && net_income < Number(task.prior_net_income) ? 'declining' : 'stable'
      }
    };
  }
}

class FundingAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'fund-agent', name: 'Funding Agent', layer: 'C' });
    this.capabilities = ['grant-sourcing', 'investor-outreach', 'cap-table-management'];
  }

  async execute(task) {
    switch (task.type) {
      case 'grant-sourcing':
        return await this.sourceGrants(task);
      case 'investor-outreach':
        return await this.outreachInvestors(task);
      case 'cap-table-management':
        return await this.manageCapTable(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async sourceGrants(task) {
    const eligible_programs = Number(task.eligible_programs) || 5;
    const avg_grant_size = Number(task.avg_grant_size) || 50000;
    const success_rate = Number(task.success_rate) || 0.3;

    const expected_grants = Math.floor(eligible_programs * success_rate);
    const expected_value = round2(expected_grants * avg_grant_size);

    return {
      success: true,
      grants_sourcing: {
        eligible_programs,
        expected_successful_grants: expected_grants,
        expected_total_value: expected_value,
        average_grant_size: round2(avg_grant_size),
        success_probability: round2(success_rate * 100),
        applications_to_submit: Math.ceil(eligible_programs / success_rate)
      }
    };
  }

  async outreachInvestors(task) {
    const target_investors = Number(task.target_investors) || 10;
    const response_rate = Number(task.response_rate) || 0.2;
    const meeting_conversion = Number(task.meeting_conversion) || 0.5;

    const responses = Math.floor(target_investors * response_rate);
    const meetings = Math.floor(responses * meeting_conversion);

    return {
      success: true,
      outreach_campaign: {
        target_investors,
        expected_responses: responses,
        expected_meetings: meetings,
        response_rate_percent: round2(response_rate * 100),
        follow_up_required: target_investors - responses
      }
    };
  }

  async manageCapTable(task) {
    const total_shares = Number(task.total_shares) || 10000000;
    const shareholders = Array.isArray(task.shareholders) ? task.shareholders.length : 0;
    const vesting_years = Number(task.vesting_years) || 4;

    const avg_ownership = shareholders > 0 ? round2((100 / shareholders)) : 0;

    return {
      success: true,
      cap_table: {
        total_shares,
        shareholder_count: shareholders,
        average_ownership_percent: avg_ownership,
        vesting_schedule_years: vesting_years,
        fully_vested_shares: Math.floor(total_shares / shareholders / 4),
        dilution_risk: shareholders > 5 ? 'high' : shareholders > 2 ? 'medium' : 'low'
      }
    };
  }
}

class RevenueAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'rev-agent', name: 'Revenue Agent', layer: 'C' });
    this.capabilities = ['pipeline-management', 'forecasting', 'deal-closing'];
  }

  async execute(task) {
    switch (task.type) {
      case 'pipeline-management':
        return await this.managePipeline(task);
      case 'forecasting':
        return await this.forecast(task);
      case 'deal-closing':
        return await this.closeDeal(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async managePipeline(task) {
    const deals = Array.isArray(task.deals) ? task.deals : [];
    const total_value = deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const weighted_value = deals.reduce((sum, d) => {
      const prob = Number(d.probability || 0.5);
      return sum + (Number(d.value || 0) * prob);
    }, 0);

    return {
      success: true,
      pipeline: {
        total_deals: deals.length,
        pipeline_value: round2(total_value),
        weighted_pipeline_value: round2(weighted_value),
        average_deal_size: deals.length > 0 ? round2(total_value / deals.length) : 0,
        pipeline_health: deals.length > 5 ? 'healthy' : deals.length > 2 ? 'adequate' : 'weak'
      }
    };
  }

  async forecast(task) {
    const current_deals = Number(task.current_deals_value) || 0;
    const new_deal_targets = Number(task.new_deal_targets) || 0;
    const growth_rate = Number(task.quarterly_growth_rate) || 0.15;
    const quarters_ahead = Number(task.forecast_quarters) || 1;

    const projected = round2(current_deals * Math.pow(1 + growth_rate, quarters_ahead) + new_deal_targets);
    const confidence = 0.75 + (growth_rate <= 0.2 ? 0.15 : -0.05);

    return {
      success: true,
      forecast: {
        base_value: round2(current_deals),
        projected_value: projected,
        quarters_ahead,
        growth_rate_percent: round2(growth_rate * 100),
        confidence_score: round2(Math.min(confidence, 0.95)),
        forecast_range: `${round2(projected * 0.85)} - ${round2(projected * 1.15)}`
      }
    };
  }

  async closeDeal(task) {
    const deal_value = Number(task.deal_value);
    const commission_percent = Number(task.commission_percent) || 5;
    const close_probability = Number(task.close_probability) || 0.8;

    if (!(deal_value > 0)) return { success: false, error: 'closeDeal requires deal_value > 0' };

    const commission = round2(deal_value * (commission_percent / 100));
    const expected_value = round2(deal_value * close_probability);

    return {
      success: true,
      deal_closure: {
        deal_value: round2(deal_value),
        commission_amount: commission,
        commission_percent,
        close_probability_percent: round2(close_probability * 100),
        expected_net_value: expected_value,
        status: 'in-negotiation'
      }
    };
  }
}

// ============================================================================
// LAYER D: OUTREACH
// ============================================================================

class OutreachAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'out-agent', name: 'Outreach Agent', layer: 'D' });
    this.capabilities = ['partner-outreach', 'event-coordination', 'relationship-management'];
  }

  async execute(task) {
    switch (task.type) {
      case 'partner-outreach':
        return await this.outreachPartners(task);
      case 'event-coordination':
        return await this.coordinateEvent(task);
      case 'relationship-management':
        return await this.manageRelationships(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async outreachPartners(task) {
    const target_partners = Number(task.target_partners) || 10;
    const outreach_channels = Array.isArray(task.channels) ? task.channels.length : 3;
    const response_rate_per_channel = Number(task.response_rate) || 0.15;

    const total_response = Math.floor(target_partners * response_rate_per_channel * outreach_channels * 0.6);

    return {
      success: true,
      outreach: {
        target_partners,
        channels_used: outreach_channels,
        expected_responses: Math.max(1, total_response),
        response_rate_percent: round2(response_rate_per_channel * 100),
        follow_ups_needed: target_partners - total_response
      }
    };
  }

  async coordinateEvent(task) {
    const event_date = task.event_date || new Date().toISOString();
    const expected_attendees = Number(task.expected_attendees) || 50;
    const confirmed_attendees = Number(task.confirmed_attendees) || 0;
    const days_until = Math.ceil((new Date(event_date) - new Date()) / (24 * 60 * 60 * 1000));

    const confirmation_rate = expected_attendees > 0 ? round2(confirmed_attendees / expected_attendees * 100) : 0;
    const status = days_until <= 0 ? 'in-progress' : confirmation_rate >= 70 ? 'confirmed' : days_until <= 7 ? 'at-risk' : 'planning';

    return {
      success: true,
      event: {
        event_date,
        expected_attendees,
        confirmed_attendees,
        confirmation_rate_percent: confirmation_rate,
        days_until_event: Math.max(0, days_until),
        status,
        tasks_remaining: status === 'planning' ? 8 : status === 'at-risk' ? 3 : 0
      }
    };
  }

  async manageRelationships(task) {
    const relationships = Array.isArray(task.relationships) ? task.relationships : [];
    const engagement_level = Number(task.avg_engagement_level) || 0.5;
    const churn_risk_count = relationships.filter(r => (r.days_since_contact || 0) > 60).length;

    return {
      success: true,
      relationships: {
        total_relationships: relationships.length,
        high_engagement_count: relationships.filter(r => (r.engagement || 0) >= 0.7).length,
        churn_risk_count,
        average_engagement: round2(engagement_level),
        relationship_health: churn_risk_count === 0 ? 'healthy' : churn_risk_count < relationships.length * 0.2 ? 'good' : 'at-risk',
        action_items: churn_risk_count > 0 ? `re-engage ${churn_risk_count} relationships` : 'maintain current contacts'
      }
    };
  }
}

class MarketingAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'mkt-agent', name: 'Marketing Agent', layer: 'D' });
    this.capabilities = ['campaign-planning', 'content-creation', 'lead-generation'];
  }

  async execute(task) {
    switch (task.type) {
      case 'campaign-planning':
        return await this.planCampaign(task);
      case 'content-creation':
        return await this.createContent(task);
      case 'lead-generation':
        return await this.generateLeads(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async planCampaign(task) {
    const budget = Number(task.budget) || 10000;
    const channels = Array.isArray(task.channels) ? task.channels : [];
    const target_reach = Number(task.target_reach) || 10000;
    const cpm = Number(task.cost_per_mille) || 5;

    const budget_per_channel = channels.length > 0 ? budget / channels.length : budget;
    const expected_impressions = Math.floor(budget / (cpm / 1000));
    const expected_ctr = 0.02;
    const expected_clicks = Math.floor(expected_impressions * expected_ctr);

    return {
      success: true,
      campaign_plan: {
        total_budget: round2(budget),
        channels: channels,
        budget_per_channel: round2(budget_per_channel),
        target_reach: target_reach,
        expected_impressions,
        expected_clicks,
        expected_ctr_percent: round2(expected_ctr * 100),
        duration_days: Number(task.duration_days) || 30
      }
    };
  }

  async createContent(task) {
    const content_types = Array.isArray(task.types) ? task.types : ['blog'];
    const pieces_per_type = Number(task.pieces_per_type) || 2;
    const hours_per_piece = Number(task.hours_per_piece) || 3;

    const total_pieces = content_types.length * pieces_per_type;
    const total_hours = total_pieces * hours_per_piece;
    const team_members = Number(task.team_size) || 1;
    const timeline_days = Math.ceil(total_hours / (team_members * 8));

    return {
      success: true,
      content_plan: {
        total_content_pieces: total_pieces,
        content_types,
        pieces_per_type,
        estimated_total_hours: total_hours,
        timeline_days,
        team_size: team_members,
        quality_target: 'high'
      }
    };
  }

  async generateLeads(task) {
    const channels = Array.isArray(task.channels) ? task.channels.length : 3;
    const budget = Number(task.budget) || 5000;
    const cpl = Number(task.cost_per_lead) || 50;

    const leads_per_channel = Math.floor((budget / channels) / cpl);
    const total_leads = leads_per_channel * channels;
    const conversion_to_opportunity = 0.15;
    const expected_opportunities = Math.floor(total_leads * conversion_to_opportunity);

    return {
      success: true,
      lead_generation: {
        channels_used: channels,
        total_budget: round2(budget),
        cost_per_lead: round2(cpl),
        projected_leads: total_leads,
        leads_per_channel: leads_per_channel,
        expected_opportunities: expected_opportunities,
        conversion_rate_percent: round2(conversion_to_opportunity * 100)
      }
    };
  }
}

class CommunityAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'com-agent', name: 'Community Agent', layer: 'D' });
    this.capabilities = ['community-management', 'user-support', 'feedback-aggregation'];
  }

  async execute(task) {
    switch (task.type) {
      case 'community-management':
        return await this.manageCommunity(task);
      case 'user-support':
        return await this.provideSupport(task);
      case 'feedback-aggregation':
        return await this.aggregateFeedback(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async manageCommunity(task) {
    const active_members = Number(task.active_members) || 100;
    const new_members_per_month = Number(task.new_members_per_month) || 20;
    const churn_rate = Number(task.monthly_churn_rate) || 0.05;

    const churn_count = Math.floor(active_members * churn_rate);
    const growth = new_members_per_month - churn_count;
    const projected_members_6mo = Math.floor(active_members + (growth * 6));

    return {
      success: true,
      community: {
        active_members,
        new_members_per_month,
        monthly_churn_rate_percent: round2(churn_rate * 100),
        churn_count_per_month: churn_count,
        net_growth_per_month: growth,
        projected_6mo_members: projected_members_6mo,
        community_health: growth > 0 ? 'growing' : growth === 0 ? 'stable' : 'declining'
      }
    };
  }

  async provideSupport(task) {
    const support_requests = Number(task.support_requests) || 50;
    const resolved = Number(task.resolved) || 40;
    const avg_resolution_hours = Number(task.avg_resolution_hours) || 4;
    const satisfaction_score = Number(task.satisfaction_score) || 0.85;

    const resolution_rate = support_requests > 0 ? round2(resolved / support_requests * 100) : 0;
    const pending = support_requests - resolved;

    return {
      success: true,
      support_metrics: {
        support_requests: support_requests,
        resolved: resolved,
        pending: pending,
        resolution_rate_percent: resolution_rate,
        average_resolution_hours: avg_resolution_hours,
        customer_satisfaction_score: round2(satisfaction_score),
        support_quality: satisfaction_score >= 0.9 ? 'excellent' : satisfaction_score >= 0.75 ? 'good' : 'needs-improvement'
      }
    };
  }

  async aggregateFeedback(task) {
    const feedback_items = Array.isArray(task.feedback) ? task.feedback : [];
    const sentiment_positive = feedback_items.filter(f => (f.sentiment || 'neutral') === 'positive').length;
    const sentiment_negative = feedback_items.filter(f => (f.sentiment || 'neutral') === 'negative').length;
    const total = feedback_items.length || 1;

    const themes = {};
    feedback_items.forEach(f => {
      const theme = f.theme || 'general';
      themes[theme] = (themes[theme] || 0) + 1;
    });

    return {
      success: true,
      feedback_summary: {
        total_feedback_items: total,
        positive_percent: round2((sentiment_positive / total) * 100),
        negative_percent: round2((sentiment_negative / total) * 100),
        top_themes: Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t} (${c})`),
        overall_sentiment: sentiment_positive > sentiment_negative ? 'positive' : sentiment_negative > sentiment_positive ? 'negative' : 'neutral'
      }
    };
  }
}

// ============================================================================
// LAYER E: FACILITY
// ============================================================================

class FacilityAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'fac-agent', name: 'Facility Agent', layer: 'E' });
    this.capabilities = ['facility-management', 'maintenance-scheduling', 'asset-tracking'];
  }

  async execute(task) {
    switch (task.type) {
      case 'facility-management':
        return await this.manageFacility(task);
      case 'maintenance-scheduling':
        return await this.scheduleMaintenance(task);
      case 'asset-tracking':
        return await this.trackAssets(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async manageFacility(task) {
    const facility_count = Number(task.facility_count) || 1;
    const occupancy_percent = Number(task.occupancy_percent) || 75;
    const compliance_issues = Number(task.compliance_issues) || 0;

    const occupancy_status = occupancy_percent >= 80 ? 'over-capacity' : occupancy_percent >= 60 ? 'healthy' : 'under-utilized';
    const facility_health = compliance_issues === 0 ? 'compliant' : compliance_issues < 3 ? 'minor-issues' : 'critical';

    return {
      success: true,
      facility_management: {
        facilities_managed: facility_count,
        occupancy_percent: occupancy_percent,
        occupancy_status,
        compliance_issues,
        facility_health,
        maintenance_backlog: Number(task.maintenance_backlog) || 0,
        next_inspection_days: Math.floor(Math.random() * 90) + 1
      }
    };
  }

  async scheduleMaintenance(task) {
    const maintenance_items = Array.isArray(task.items) ? task.items : [];
    const technician_count = Number(task.technician_count) || 2;
    const hours_per_item = Number(task.hours_per_item) || 2;

    const total_items = maintenance_items.length || 1;
    const total_hours = total_items * hours_per_item;
    const days_needed = Math.ceil(total_hours / (technician_count * 8));
    const critical_items = maintenance_items.filter(m => m.priority === 'critical').length;

    return {
      success: true,
      maintenance_schedule: {
        total_items: total_items,
        critical_items,
        non_urgent_items: total_items - critical_items,
        estimated_days: days_needed,
        technicians_allocated: technician_count,
        start_date: new Date().toISOString().split('T')[0],
        completion_target: new Date(Date.now() + days_needed * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    };
  }

  async trackAssets(task) {
    const total_assets = Number(task.total_assets) || 100;
    const tracked_assets = Number(task.tracked_assets) || 90;
    const missing_assets = total_assets - tracked_assets;
    const assets_due_renewal = Number(task.due_renewal) || 5;

    const tracking_rate = round2((tracked_assets / total_assets) * 100);
    const asset_health = missing_assets === 0 ? 'all-accounted' : missing_assets < 5 ? 'good' : 'needs-audit';

    return {
      success: true,
      asset_tracking: {
        total_assets,
        tracked_assets,
        missing_assets,
        tracking_rate_percent: tracking_rate,
        assets_due_renewal,
        asset_health,
        last_audit_date: task.last_audit_date || 'pending',
        next_audit_overdue: missing_assets > 5
      }
    };
  }
}

class SecurityAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'sec-agent', name: 'Security Agent', layer: 'E' });
    this.capabilities = ['threat-assessment', 'access-control', 'incident-response'];
  }

  async execute(task) {
    switch (task.type) {
      case 'threat-assessment':
        return await this.assessThreat(task);
      case 'access-control':
        return await this.manageAccess(task);
      case 'incident-response':
        return await this.respondIncident(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async assessThreat(task) {
    const vulnerabilities = Array.isArray(task.vulnerabilities) ? task.vulnerabilities : [];
    const critical_count = vulnerabilities.filter(v => v.severity === 'critical').length;
    const high_count = vulnerabilities.filter(v => v.severity === 'high').length;

    const threat_score = round2((critical_count * 0.5 + high_count * 0.2) / Math.max(vulnerabilities.length, 1));
    const threat_level = critical_count > 0 ? 'critical' : high_count > 0 ? 'high' : critical_count + high_count === 0 ? 'low' : 'medium';

    return {
      success: true,
      threat_assessment: {
        total_vulnerabilities: vulnerabilities.length,
        critical_vulnerabilities: critical_count,
        high_vulnerabilities: high_count,
        threat_score: threat_score,
        threat_level,
        remediation_priority: critical_count > 0 ? 'immediate' : high_count > 2 ? 'urgent' : 'scheduled',
        next_assessment_days: 30
      }
    };
  }

  async manageAccess(task) {
    const access_requests = Number(task.access_requests) || 0;
    const approved = Number(task.approved) || 0;
    const denied = Number(task.denied) || 0;
    const pending = access_requests - approved - denied;

    const approval_rate = access_requests > 0 ? round2((approved / access_requests) * 100) : 0;

    return {
      success: true,
      access_control: {
        total_access_requests: access_requests,
        approved_requests: approved,
        denied_requests: denied,
        pending_requests: pending,
        approval_rate_percent: approval_rate,
        average_review_hours: 4,
        compliance_status: denial_rate => denial_rate < 10 ? 'compliant' : 'review-needed'
      }
    };
  }

  async respondIncident(task) {
    const incident_type = task.incident_type || 'security-incident';
    const severity = task.severity || 'medium';
    const detection_time_minutes = Number(task.detection_time_minutes) || 15;
    const response_time_minutes = Number(task.response_time_minutes) || 10;

    const mttr = round2((detection_time_minutes + response_time_minutes) / 60);
    const resolution_status = task.resolved ? 'resolved' : 'in-progress';

    return {
      success: true,
      incident_response: {
        incident_type,
        severity,
        detection_time_minutes,
        response_time_minutes,
        mttr_hours: mttr,
        status: resolution_status,
        root_cause_identified: task.resolved ? true : false,
        lessons_learned: task.resolved ? 'pending' : 'in-process'
      }
    };
  }
}

class WorkflowAgent extends HeidiAgent {
  constructor(config) {
    super({ ...config, id: 'wf-agent', name: 'Workflow Agent', layer: 'E' });
    this.capabilities = ['process-automation', 'workflow-optimization', 'task-routing'];
  }

  async execute(task) {
    switch (task.type) {
      case 'process-automation':
        return await this.automateProcess(task);
      case 'workflow-optimization':
        return await this.optimizeWorkflow(task);
      case 'task-routing':
        return await this.routeTask(task);
      default:
        return { success: false, error: 'Unknown task type' };
    }
  }

  async automateProcess(task) {
    const manual_steps = Number(task.manual_steps) || 5;
    const automation_potential = Number(task.automation_potential) || 0.75;
    const time_per_manual_step = Number(task.time_per_step_minutes) || 10;

    const automatable_steps = Math.floor(manual_steps * automation_potential);
    const time_saved_per_cycle = automatable_steps * time_per_manual_step;
    const cycles_per_month = Number(task.cycles_per_month) || 20;
    const total_time_saved = time_saved_per_cycle * cycles_per_month;

    return {
      success: true,
      automation_plan: {
        total_manual_steps: manual_steps,
        automatable_steps,
        non_automatable_steps: manual_steps - automatable_steps,
        time_saved_per_cycle_minutes: time_saved_per_cycle,
        cycles_per_month,
        total_monthly_time_saved_hours: round2(total_time_saved / 60),
        roi_months: 2,
        implementation_complexity: automation_potential > 0.8 ? 'low' : automation_potential > 0.5 ? 'medium' : 'high'
      }
    };
  }

  async optimizeWorkflow(task) {
    const current_cycle_time = Number(task.current_cycle_time_hours) || 8;
    const optimization_opportunities = Array.isArray(task.opportunities) ? task.opportunities.length : 3;
    const time_savings_per_opportunity = Number(task.avg_savings_hours) || 0.5;

    const total_potential_savings = optimization_opportunities * time_savings_per_opportunity;
    const optimized_cycle_time = Math.max(1, current_cycle_time - total_potential_savings);
    const improvement_percent = round2(((current_cycle_time - optimized_cycle_time) / current_cycle_time) * 100);

    return {
      success: true,
      workflow_optimization: {
        current_cycle_time_hours: current_cycle_time,
        optimization_opportunities,
        projected_cycle_time_hours: round2(optimized_cycle_time),
        improvement_percent,
        time_savings_hours: round2(total_potential_savings),
        implementation_phases: Math.ceil(optimization_opportunities / 2),
        expected_completion_weeks: 4
      }
    };
  }

  async routeTask(task) {
    const task_type = task.type_name || 'general';
    const available_workers = Number(task.available_workers) || 5;
    const task_complexity = Number(task.complexity_score) || 0.5;
    const workload = Array.isArray(task.worker_loads) ? task.worker_loads : [];

    const best_worker_idx = workload.length > 0
      ? workload.indexOf(Math.min(...workload))
      : 0;
    const assigned_worker = best_worker_idx + 1;
    const eta_hours = (task_complexity * 4) + (best_worker_idx > 0 ? 0.5 : 0);

    return {
      success: true,
      task_routing: {
        task_type,
        assigned_worker,
        worker_skill_match: 0.85 + (Math.random() * 0.1),
        estimated_duration_hours: round2(eta_hours),
        priority_queue_position: 1,
        sla_hours: 24,
        status: 'routed'
      }
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Base
  HeidiAgent,

  // Layer A: Strategic
  ArchitectAgent,
  EnergyAgent,
  AISystemsAgent,

  // Layer B: Execution
  ProcurementAgent,
  ConstructionAgent,
  FabricationAgent,

  // Layer C: Finance
  FinanceAgent,
  FundingAgent,
  RevenueAgent,

  // Layer D: Outreach
  OutreachAgent,
  MarketingAgent,
  CommunityAgent,

  // Layer E: Facility
  FacilityAgent,
  SecurityAgent,
  WorkflowAgent
};
