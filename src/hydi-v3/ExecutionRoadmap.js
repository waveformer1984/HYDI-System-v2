'use strict';

const { EventEmitter } = require('events');

/**
 * ExecutionRoadmap produces a time-ordered, resource-aware execution plan
 * for a set of goals or mission phases. It uses forecasts and risk scores
 * to guide sequencing while remaining deterministic and explainable.
 */
class ExecutionRoadmap extends EventEmitter {
  constructor(config = {}) {
    super();
    this.dependencyPlanner = config.dependencyPlanner || null;
    this.forecastEngine = config.forecastEngine || null;
    this.riskAnalyzer = config.riskAnalyzer || null;
    this.resourceAllocator = config.resourceAllocator || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.roadmaps = new Map();
    this._clock = 0;
  }

  createRoadmap(items, options = {}) {
    if (!this.dependencyPlanner) return { success: false, error: 'no_dependency_planner' };
    const order = this.dependencyPlanner.order(items);
    if (!order.success) return order;

    const roadmap = {
      id: `rm-${Date.now()}-${++this._clock}`,
      items: [],
      totalDuration: 0,
      totalRisk: 0,
      createdAt: Date.now(),
    };

    for (const item of order.ordered) {
      const resources = this.resourceAllocator ? this.resourceAllocator.available() : {};
      const forecast = this.forecastEngine ? this.forecastEngine.forecast(item, resources).forecast : null;
      const risk = this.riskAnalyzer ? this.riskAnalyzer.analyze({ task: item }).assessment : null;
      const step = {
        itemId: item.id,
        title: item.title,
        start: roadmap.totalDuration,
        duration: forecast ? forecast.duration : 0,
        risk: risk ? risk.overall : 0,
        bottlenecks: forecast ? forecast.bottlenecks : [],
      };
      roadmap.items.push(step);
      roadmap.totalDuration += step.duration;
      roadmap.totalRisk = Math.max(roadmap.totalRisk, step.risk);
    }

    this.roadmaps.set(roadmap.id, roadmap);
    this._audit('roadmap_created', roadmap);
    this.emit('roadmap_created', roadmap);
    return { success: true, roadmap };
  }

  updateProgress(roadmapId, itemId, status) {
    const roadmap = this.roadmaps.get(roadmapId);
    if (!roadmap) return { success: false, error: 'roadmap_not_found' };
    const step = roadmap.items.find((s) => s.itemId === itemId);
    if (!step) return { success: false, error: 'item_not_found' };
    step.status = status;
    step.updatedAt = Date.now();
    this._audit('roadmap_updated', roadmap, { itemId, status });
    this.emit('roadmap_updated', { roadmap, step });
    return { success: true, step };
  }

  render(roadmapId) {
    const roadmap = this.roadmaps.get(roadmapId);
    if (!roadmap) return null;
    return {
      id: roadmap.id,
      totalDuration: roadmap.totalDuration,
      totalRisk: roadmap.totalRisk,
      steps: roadmap.items.map((s) => ({
        itemId: s.itemId,
        title: s.title,
        start: s.start,
        duration: s.duration,
        risk: s.risk,
        status: s.status || 'pending',
      })),
    };
  }

  _audit(action, roadmap, context = {}) {
    const entry = { at: Date.now(), action, roadmapId: roadmap.id, context };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = ExecutionRoadmap;
