'use strict';

/**
 * Specialized executive agents that analyze the BusinessMemory world model
 * and produce structured reports for the ExecutiveOperatingSystem.
 *
 * Each agent has a single responsibility and does not duplicate another's work.
 * Agents are stateless; all decisions are evidence-based on BusinessMemory.
 */

class ExecutiveAgent {
  constructor(name) {
    this.name = name;
  }

  report(memory) {
    throw new Error('report() must be implemented');
  }

  _find(memory, query) {
    return memory.find(query);
  }
}

class OperationsManager extends ExecutiveAgent {
  constructor() {
    super('Operations Manager');
  }

  report(memory) {
    const active = memory.find({ type: 'task', status: 'active' });
    const blocked = memory.find({ type: 'task', status: 'blocked' });
    const bottleneck = blocked.sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    return {
      activeTaskCount: active.length,
      blockedTaskCount: blocked.length,
      topBottleneck: bottleneck ? { id: bottleneck.id, name: bottleneck.name, value: bottleneck.value } : null,
    };
  }
}

class SalesManager extends ExecutiveAgent {
  constructor() {
    super('Sales Manager');
  }

  report(memory) {
    const opportunities = memory.find({ type: 'opportunity', status: 'active' });
    const totalValue = opportunities.reduce((sum, o) => sum + (o.value || 0), 0);
    const leads = memory.find({ type: 'client', tags: ['lead'] });
    const customers = memory.find({ type: 'client', status: 'active' });
    return {
      openOpportunities: opportunities.length,
      pipelineValue: totalValue,
      activeLeads: leads.length,
      activeCustomers: customers.length,
    };
  }
}

class ManufacturingManager extends ExecutiveAgent {
  constructor() {
    super('Manufacturing Manager');
  }

  report(memory) {
    const equipment = memory.find({ type: 'equipment' });
    const active = equipment.filter((e) => e.status === 'active');
    const needsMaintenance = equipment.filter((e) => e.status === 'maintenance' || e.payload?.nextMaintenance < Date.now());
    const inventory = memory.find({ type: 'equipment', tags: ['inventory'] });
    const lowInventory = inventory.filter((i) => (i.payload?.quantity ?? Infinity) <= (i.payload?.reorderThreshold ?? 0));
    return {
      equipmentCount: equipment.length,
      activeEquipment: active.length,
      needsMaintenance: needsMaintenance.map((e) => ({ id: e.id, name: e.name })),
      lowInventory: lowInventory.map((i) => ({ id: i.id, name: i.name })),
    };
  }
}

class ResearchManager extends ExecutiveAgent {
  constructor() {
    super('Research Manager');
  }

  report(memory) {
    const experiments = memory.find({ type: 'project', tags: ['research'] });
    const active = experiments.filter((e) => e.status === 'active');
    const completed = experiments.filter((e) => e.status === 'completed');
    return {
      activeExperiments: active.length,
      completedExperiments: completed.length,
      topExperiment: active.sort((a, b) => (b.value || 0) - (a.value || 0))[0] || null,
    };
  }
}

class CreativeDirector extends ExecutiveAgent {
  constructor() {
    super('Creative Director');
  }

  report(memory) {
    const creative = memory.find({ type: 'project', tags: ['creative'] });
    const active = creative.filter((c) => c.status === 'active');
    const prototypes = memory.find({ type: 'product', status: 'prototype' });
    return {
      activeCreativeProjects: active.length,
      prototypeCount: prototypes.length,
      topCreativeProject: active.sort((a, b) => (b.value || 0) - (a.value || 0))[0] || null,
    };
  }
}

class FinanceAnalyst extends ExecutiveAgent {
  constructor() {
    super('Finance Analyst');
  }

  report(memory) {
    const opportunities = memory.find({ type: 'opportunity', status: 'active' });
    const revenue = opportunities.reduce((sum, o) => sum + (o.value || 0), 0);
    const expenses = memory.find({ type: 'expense' });
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.value || 0), 0);
    const assets = memory.find({ type: 'asset' });
    const assetValue = assets.reduce((sum, a) => sum + (a.value || 0), 0);
    return {
      revenueOpportunityValue: revenue,
      trackedExpenses: totalExpenses,
      assetValue,
      projectedNet: revenue - totalExpenses,
    };
  }
}

class TechnicalArchitect extends ExecutiveAgent {
  constructor() {
    super('Technical Architect');
  }

  report(memory) {
    const systems = memory.find({ type: 'equipment', tags: ['system'] });
    const degraded = systems.filter((s) => s.status === 'degraded' || s.status === 'maintenance');
    const debt = memory.find({ type: 'task', tags: ['tech-debt'] });
    return {
      systemCount: systems.length,
      degradedSystems: degraded.map((s) => ({ id: s.id, name: s.name })),
      techDebtCount: debt.length,
    };
  }
}

module.exports = {
  ExecutiveAgent,
  OperationsManager,
  SalesManager,
  ManufacturingManager,
  ResearchManager,
  CreativeDirector,
  FinanceAnalyst,
  TechnicalArchitect,
};
