'use strict';

const DEFAULT_KPIS = [
  { id: 'revenue', name: 'Revenue', unit: 'USD', target: 0 },
  { id: 'grossMargin', name: 'Gross Margin', unit: 'percent', target: 0 },
  { id: 'engineeringVelocity', name: 'Engineering Velocity', unit: 'commits/day', target: 0 },
  { id: 'manufacturingThroughput', name: 'Manufacturing Throughput', unit: 'units/day', target: 0 },
  { id: 'machineUtilization', name: 'Machine Utilization', unit: 'percent', target: 0 },
  { id: 'inventoryHealth', name: 'Inventory Health', unit: 'score', target: 0 },
  { id: 'customerGrowth', name: 'Customer Growth', unit: 'count', target: 0 },
  { id: 'projectCompletion', name: 'Project Completion', unit: 'percent', target: 0 },
  { id: 'researchProgress', name: 'Research Progress', unit: 'percent', target: 0 },
  { id: 'creativeOutput', name: 'Creative Output', unit: 'count', target: 0 },
  { id: 'resonateDevelopment', name: 'Resonate Development', unit: 'score', target: 0 },
  { id: 'protoForgeOperations', name: 'ProtoForge Operations', unit: 'score', target: 0 },
];

class BusinessKPIRegistry {
  constructor() {
    this.kpis = new Map();
    for (const kpi of DEFAULT_KPIS) {
      this.register(kpi);
    }
  }

  register(kpi, evaluator) {
    if (!kpi || !kpi.id || !kpi.name) {
      throw new Error('KPI must have id and name');
    }
    this.kpis.set(kpi.id, {
      ...kpi,
      unit: kpi.unit || 'count',
      target: Number(kpi.target) || 0,
      evaluator: evaluator || null,
    });
    return this;
  }

  get(id) {
    return this.kpis.get(id);
  }

  list() {
    return Array.from(this.kpis.values()).map((k) => ({ id: k.id, name: k.name, unit: k.unit, target: k.target }));
  }

  evaluate(id, context = {}) {
    const kpi = this.kpis.get(id);
    if (!kpi) return null;
    let value = context[id];
    if (kpi.evaluator && typeof kpi.evaluator === 'function') {
      value = kpi.evaluator(context);
    }
    value = Number.isFinite(Number(value)) ? Number(value) : null;
    const status = value === null ? 'unknown' : value >= kpi.target ? 'target-met' : 'below-target';
    return {
      id: kpi.id,
      name: kpi.name,
      unit: kpi.unit,
      target: kpi.target,
      value,
      status,
    };
  }

  evaluateAll(context = {}) {
    const out = {};
    for (const id of this.kpis.keys()) {
      out[id] = this.evaluate(id, context);
    }
    return out;
  }
}

module.exports = BusinessKPIRegistry;
