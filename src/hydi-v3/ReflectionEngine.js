'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * ReflectionEngine generates a permanent reflection for every completed mission
 * and maintains decaying strategy rankings for outreach, marketing, grant searches,
 * automation, coding patterns, and revenue generators.
 */
class ReflectionEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      storagePath: config.storagePath || path.resolve(__dirname, '../../data/reflections'),
      decayFactor: config.decayFactor || 0.95,
      minSamples: config.minSamples || 3,
      persistDebounceMs: config.persistDebounceMs ?? 50,
      ...config,
    };

    this.reflections = [];
    this.strategyRankings = {
      outreach: new Map(),
      marketing: new Map(),
      grant: new Map(),
      automation: new Map(),
      coding: new Map(),
      revenue: new Map(),
    };

    this._loaded = false;
    this._destroyed = false;
    this._persistTimer = null;
    this._persistPromise = null;
    this._persistResolve = null;
  }

  async initialize() {
    if (this._destroyed) return;
    if (this._loaded) return;
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      await this.load();
    } catch (err) {
      console.error('[REFLECTION ENGINE] Initialization failed:', err.message);
    }
    this._loaded = true;
  }

  destroy() {
    this._destroyed = true;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._persistResolve) {
      this._persistResolve();
      this._persistResolve = null;
      this._persistPromise = null;
    }
    this.reflections = [];
    for (const cat of Object.keys(this.strategyRankings)) {
      this.strategyRankings[cat].clear();
    }
  }

  /**
   * Reflect on a completed mission.
   */
  async reflectOnMission(mission) {
    if (this._destroyed) return null;
    await this.initialize();

    if (!mission) return null;

    const tasks = mission.tasks || [];
    const succeeded = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'permanently_failed');

    const rootCauses = this.identifyRootCauses(failed);
    const bestStrategies = this.rankStrategies(tasks, true);
    const worstStrategies = this.rankStrategies(tasks, false);

    const reflection = {
      id: `reflection_${randomUUID()}`,
      missionId: mission.id,
      timestamp: new Date().toISOString(),
      succeeded: succeeded.map((t) => ({ id: t.id, type: t.type, strategy: t.result?.strategy })),
      failed: failed.map((t) => ({ id: t.id, type: t.type, error: t.error })),
      rootCauses,
      lessonsLearned: this.extractLessons(mission, succeeded, failed),
      bestStrategies,
      worstStrategies,
      recommendedImprovements: this.recommendImprovements(mission, rootCauses, bestStrategies, worstStrategies),
      revenue: mission.revenue || 0,
      progress: mission.progress || 0,
    };

    this.reflections.push(reflection);

    // Update strategy rankings
    this.updateStrategyRankings(tasks, mission.revenue || 0);

    await this.persist();
    this.emit('reflection_generated', { missionId: mission.id, reflectionId: reflection.id });
    return reflection;
  }

  identifyRootCauses(failedTasks) {
    const causes = new Map();
    for (const task of failedTasks) {
      const error = task.error || 'unknown';
      const root = this.categorizeRootCause(error);
      causes.set(root, (causes.get(root) || 0) + 1);
    }
    return Array.from(causes.entries()).map(([cause, count]) => ({ cause, count }));
  }

  categorizeRootCause(error) {
    const e = String(error).toLowerCase();
    if (e.includes('timeout')) return 'timeout';
    if (e.includes('network') || e.includes('econn') || e.includes('fetch')) return 'network_error';
    if (e.includes('auth') || e.includes('unauthorized') || e.includes('key')) return 'authentication_failure';
    if (e.includes('rate limit') || e.includes('429') || e.includes('too many')) return 'rate_limit';
    if (e.includes('memory') || e.includes('oom') || e.includes('heap')) return 'memory_pressure';
    if (e.includes('database') || e.includes('supabase') || e.includes('postgres')) return 'database_error';
    if (e.includes('permission') || e.includes('access denied')) return 'permission_denied';
    return 'unknown';
  }

  extractLessons(mission, succeeded, failed) {
    const lessons = [];
    if (succeeded.length > failed.length) {
      lessons.push('mission_execution_outperformed_failures');
    }
    if (failed.some((t) => String(t.error).toLowerCase().includes('timeout'))) {
      lessons.push('add_timeouts_and_retries_for_unstable_paths');
    }
    if (mission.replanCount > 0) {
      lessons.push('initial_planning_can_be_improved');
    }
    if (mission.revenue > 0 && mission.progress === 1) {
      lessons.push('revenue_missions_benefit_from_clear_dependency_order');
    }
    return lessons;
  }

  rankStrategies(tasks, best) {
    const scores = new Map();
    for (const task of tasks) {
      const strategy = task.result?.strategy || task.assignedAgent || task.type;
      if (!strategy) continue;
      const success = task.status === 'completed' ? 1 : 0;
      const current = scores.get(strategy) || { total: 0, success: 0 };
      current.total++;
      current.success += success;
      scores.set(strategy, current);
    }

    const ranked = Array.from(scores.entries())
      .map(([strategy, { total, success }]) => ({
        strategy,
        total,
        successRate: total === 0 ? 0 : success / total,
      }))
      .sort((a, b) => (best ? b.successRate - a.successRate : a.successRate - b.successRate));

    return ranked.slice(0, 5);
  }

  recommendImprovements(mission, rootCauses, bestStrategies, worstStrategies) {
    const recs = [];
    const topCause = rootCauses[0];
    if (topCause) {
      recs.push(`address_${topCause.cause}`);
    }
    if (bestStrategies.length) {
      recs.push(`prefer_strategy_${bestStrategies[0].strategy}`);
    }
    if (worstStrategies.length) {
      recs.push(`avoid_strategy_${worstStrategies[0].strategy}`);
    }
    if (mission.failureCount > 3) {
      recs.push('reduce_mission_scope');
    }
    return recs;
  }

  /**
   * Update long-term strategy rankings by category.
   */
  updateStrategyRankings(tasks, revenue) {
    for (const task of tasks) {
      const category = this.mapTaskTypeToCategory(task.type);
      const strategy = task.result?.strategy || task.assignedAgent || task.type;
      if (!strategy) continue;

      const map = this.strategyRankings[category];
      const current = map.get(strategy) || { score: 0.5, samples: 0, revenue: 0 };
      const success = task.status === 'completed' ? 1 : 0;
      const decay = Math.pow(this.config.decayFactor, current.samples);

      current.score = (current.score * decay + success) / (decay + 1);
      current.samples++;
      current.revenue += revenue / tasks.length;
      map.set(strategy, current);
    }
  }

  mapTaskTypeToCategory(type) {
    const t = String(type).toLowerCase();
    if (t.includes('email') || t.includes('outreach') || t.includes('contact')) return 'outreach';
    if (t.includes('market') || t.includes('ad') || t.includes('promo')) return 'marketing';
    if (t.includes('grant') || t.includes('fund')) return 'grant';
    if (t.includes('script') || t.includes('bot') || t.includes('automate')) return 'automation';
    if (t.includes('code') || t.includes('debug') || t.includes('build')) return 'coding';
    if (t.includes('revenue') || t.includes('payment') || t.includes('offer')) return 'revenue';
    return 'automation';
  }

  getBestStrategy(category = 'revenue') {
    const map = this.strategyRankings[category];
    if (!map) return null;
    let best = null;
    for (const [strategy, data] of map) {
      if (!best || data.score > best.score) {
        best = { strategy, ...data };
      }
    }
    return best;
  }

  getWorstStrategy(category = 'revenue') {
    const map = this.strategyRankings[category];
    if (!map) return null;
    let worst = null;
    for (const [strategy, data] of map) {
      if (!worst || data.score < worst.score) {
        worst = { strategy, ...data };
      }
    }
    return worst;
  }

  getStrategyRankings(category) {
    const map = this.strategyRankings[category];
    if (!map) return [];
    return Array.from(map.entries())
      .map(([strategy, data]) => ({ strategy, ...data }))
      .sort((a, b) => b.score - a.score);
  }

  getStatus() {
    const rankings = {};
    for (const cat of Object.keys(this.strategyRankings)) {
      rankings[cat] = this.getStrategyRankings(cat);
    }
    return {
      totalReflections: this.reflections.length,
      latestReflection: this.reflections[this.reflections.length - 1] || null,
      rankings,
    };
  }

  async persist() {
    if (this._destroyed) return;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    const previousResolve = this._persistResolve;
    this._persistPromise = new Promise((resolve) => {
      this._persistResolve = resolve;
    });
    if (previousResolve) previousResolve();
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._doPersist().finally(() => {
        if (this._persistResolve) {
          this._persistResolve();
          this._persistResolve = null;
          this._persistPromise = null;
        }
      });
    }, this.config.persistDebounceMs).unref();
    return this._persistPromise;
  }

  async _doPersist() {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const rankings = {};
      for (const cat of Object.keys(this.strategyRankings)) {
        rankings[cat] = Array.from(this.strategyRankings[cat].entries());
      }
      const file = path.join(this.config.storagePath, 'reflections.json');
      await fs.writeFile(file, JSON.stringify({ reflections: this.reflections, rankings }, null, 2));
    } catch (err) {
      if (!this._destroyed) {
        console.error('[REFLECTION ENGINE] Persist failed:', err.message);
      }
    }
  }

  async load() {
    const file = path.join(this.config.storagePath, 'reflections.json');
    try {
      const data = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed.reflections)) this.reflections = parsed.reflections;
      if (parsed.rankings) {
        for (const cat of Object.keys(this.strategyRankings)) {
          if (parsed.rankings[cat]) {
            this.strategyRankings[cat] = new Map(parsed.rankings[cat]);
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.reflections = [];
      }
    }
  }
}

module.exports = ReflectionEngine;
