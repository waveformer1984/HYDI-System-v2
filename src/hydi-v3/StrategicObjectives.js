'use strict';

const DEFAULT_OBJECTIVES = [
  {
    id: 'resonate',
    name: 'Resonate',
    category: 'flagship',
    priority: 'highest',
    strategicWeight: 0.5,
    revenueMultiplier: 1.5,
    ecosystemValue: 1.0,
    ownerPriority: 'resonate',
    active: true,
    description: 'Flagship music production and creative ecosystem application.',
    successMetrics: ['release-readiness', 'user-adoption', 'revenue', 'brand-recognition'],
    signals: ['resonate', 'music', 'release', 'creative'],
  },
  {
    id: 'protoforge-operations',
    name: 'ProtoForge Operations',
    category: 'operations',
    priority: 'high',
    strategicWeight: 0.2,
    revenueMultiplier: 1.0,
    ecosystemValue: 0.8,
    ownerPriority: 'operations',
    active: true,
    description: 'Core business operations, infrastructure, and delivery.',
    successMetrics: ['uptime', 'throughput', 'cost-control', 'delivery-reliability'],
    signals: ['operations', 'infrastructure', 'delivery'],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    category: 'manufacturing',
    priority: 'medium',
    strategicWeight: 0.2,
    revenueMultiplier: 1.1,
    ecosystemValue: 0.6,
    ownerPriority: 'manufacturing',
    active: true,
    description: 'Physical production, equipment, and material pipeline.',
    successMetrics: ['yield', 'equipment-utilization', 'material-efficiency'],
    signals: ['manufacturing', 'produce', 'printer', 'equipment', 'material'],
  },
  {
    id: 'music',
    name: 'Music',
    category: 'creative',
    priority: 'medium',
    strategicWeight: 0.25,
    revenueMultiplier: 1.2,
    ecosystemValue: 0.7,
    ownerPriority: 'music',
    active: true,
    description: 'Creative and music assets outside the Resonate flagship.',
    successMetrics: ['catalog-growth', 'licensing-revenue'],
    signals: ['music', 'song', 'album', 'creative'],
  },
  {
    id: 'research',
    name: 'Research',
    category: 'research',
    priority: 'medium',
    strategicWeight: 0.2,
    revenueMultiplier: 0.9,
    ecosystemValue: 0.9,
    ownerPriority: 'research',
    active: true,
    description: 'Experiments, prototypes, and knowledge capture.',
    successMetrics: ['prototype-completion', 'knowledge-transfer', 'innovation-rate'],
    signals: ['research', 'experiment', 'prototype', 'knowledge'],
  },
];

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function isMatch(entity, signals) {
  const text = `${entity.name || ''} ${(entity.description || '')} ${(entity.tags || []).join(' ')}`.toLowerCase();
  return signals.some((s) => text.includes(s));
}

/**
 * StrategicObjectives is the single registry for configurable business priorities.
 *
 * No component should hard-code Resonate or any other flagship. Instead, they
 * call StrategicObjectives.score(entity, ownerPriority) and read the objective
 * registry when generating briefings or dashboards.
 */
class StrategicObjectives {
  constructor(config = {}) {
    this.objectives = new Map();
    this.ownerPriority = config.ownerPriority || 'default';
    for (const obj of (config.objectives || DEFAULT_OBJECTIVES)) {
      this.register(obj);
    }
  }

  register(objective) {
    if (!objective.id || !objective.name) throw new Error('Objective must have id and name');
    this.objectives.set(objective.id, { ...objective, active: objective.active !== false });
    return objective.id;
  }

  get(id) {
    return this.objectives.get(id);
  }

  getAll() {
    return Array.from(this.objectives.values()).sort((a, b) => this._priorityRank(a.priority) - this._priorityRank(b.priority));
  }

  getActive() {
    return this.getAll().filter((o) => o.active);
  }

  getByOwnerPriority(priority) {
    for (const obj of this.objectives.values()) {
      if (obj.ownerPriority === priority && obj.active) return obj;
    }
    return null;
  }

  setOwnerPriority(priority) {
    this.ownerPriority = priority || 'default';
    return this.ownerPriority;
  }

  _priorityRank(p) {
    const ranks = { highest: 0, high: 1, medium: 2, low: 3 };
    return ranks[p] ?? 4;
  }

  /**
   * Determine which active objective an entity best matches.
   */
  match(entity) {
    for (const obj of this.getActive()) {
      if (isMatch(entity, obj.signals)) return obj;
    }
    return null;
  }

  /**
   * Score an entity using the strategic framework.
   *
   * entity: { value, effort, risk, strategic, tags, name, description }
   */
  score(entity) {
    const effort = Math.max(entity.effort || 1, 1);
    const risk = 1 - clamp(entity.risk || 0, 0, 1);
    const entityStrategic = clamp(entity.strategic || 0, 0, 1);
    const objective = this.match(entity);

    let strategicMultiplier = 1 + entityStrategic;
    let revenueMultiplier = 1;
    let ecosystemMultiplier = 1;
    let reasonParts = [];

    if (objective) {
      strategicMultiplier += objective.strategicWeight;
      revenueMultiplier = objective.revenueMultiplier;
      ecosystemMultiplier = 1 + (objective.ecosystemValue * 0.2);
      reasonParts.push(`objective:${objective.id}`);

      if (this.ownerPriority !== 'default' && objective.ownerPriority === this.ownerPriority) {
        strategicMultiplier += 0.4;
        reasonParts.push('owner-priority');
      }
    }

    const base = (entity.value || 0) * risk * strategicMultiplier * revenueMultiplier * ecosystemMultiplier;
    return {
      score: base / effort,
      strategicMultiplier,
      revenueMultiplier,
      ecosystemMultiplier,
      reason: reasonParts.length ? reasonParts.join(',') : 'base',
      objective: objective ? objective.id : null,
    };
  }

  /**
   * Score a recommendation object for the workflow/recommendation engine.
   */
  scoreRecommendation(rec, ownerPriority = this.ownerPriority) {
    const text = `${rec.action || rec.title || ''} ${rec.reason || rec.detail || ''}`.toLowerCase();
    let strategicMultiplier = 1;
    let revenueMultiplier = 1;
    let ecosystemMultiplier = 1;
    let reasonParts = [];

    for (const obj of this.getActive()) {
      if (obj.signals.some((s) => text.includes(s))) {
        strategicMultiplier += obj.strategicWeight;
        revenueMultiplier = obj.revenueMultiplier;
        ecosystemMultiplier = 1 + (obj.ecosystemValue * 0.2);
        reasonParts.push(`objective:${obj.id}`);
        if (obj.ownerPriority === ownerPriority) {
          strategicMultiplier += 0.4;
          reasonParts.push('owner-priority');
        }
        break;
      }
    }

    const value = this._extractValue(rec.expectedImpact || '') || (rec.value || 0);
    const effort = Math.max(rec.requiredEffort || rec.effort || 1, 1);
    const risk = 1 - clamp(rec.risk || 0, 0, 1);
    const urgency = 1 + clamp(rec.urgency || 0.5, 0, 1);
    const base = value * risk * strategicMultiplier * revenueMultiplier * ecosystemMultiplier * urgency;
    return {
      score: base / effort,
      objective: reasonParts.length ? reasonParts[0].replace('objective:', '') : null,
      reason: reasonParts.length ? reasonParts.join(',') : 'base',
    };
  }

  _extractValue(text) {
    if (typeof text !== 'string') return 0;
    const match = text.match(/\$?([0-9,]+(?:\.[0-9]{2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : 0;
  }

  /**
   * Build a strategic objectives status block for briefings and dashboards.
   */
  summarize(memory) {
    const objectives = this.getActive().map((obj) => {
      const related = memory ? memory.find({ tags: [obj.id] }) : [];
      const active = related.filter((e) => e.status === 'active');
      const completed = related.filter((e) => e.status === 'completed');
      const blocked = related.filter((e) => e.status === 'blocked');
      return {
        ...obj,
        activeEntities: active.length,
        completedEntities: completed.length,
        blockedEntities: blocked.length,
        health: blocked.length > active.length ? 'at-risk' : 'stable',
      };
    });
    return objectives;
  }
}

module.exports = StrategicObjectives;
