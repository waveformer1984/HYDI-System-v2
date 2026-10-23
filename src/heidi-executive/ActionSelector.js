/**
 * HEIDI Operational Decision Engine — Deterministic Action Selection and Scoring
 */

class ActionSelector {
  constructor(options = {}) {
    this.history = options.history || [];
    this.registry = options.registry || null;
    this.cooldowns = new Map();
  }

  score(action, context = {}) {
    const { capability, dependencies = {}, recentFailures = [], maintenance = false } = context;
    let score = 0;
    const reasons = [];

    // Success history from supplied history (or incident-like records)
    const outcomes = this.history.filter(h => h.action === action.id);
    const successes = outcomes.filter(h => h.success).length;
    const attempts = outcomes.length;
    const successRate = attempts > 0 ? successes / attempts : 0.5;
    score += successRate * 3;
    if (successRate >= 0.8) reasons.push('strong historical success');
    else if (successRate === 0.5) reasons.push('no prior history');
    else if (attempts > 0) reasons.push('poor historical success');

    // Risk/reversibility
    const riskMap = { READ: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const risk = capability ? (riskMap[capability.riskLevel] || 2) : 2;
    score -= risk;
    reasons.push(`risk level ${capability ? capability.riskLevel : 'unknown'}`);

    if (capability && capability.reversible === false) {
      score -= 3;
      reasons.push('irreversible');
    }

    // Dependency readiness
    const ready = Object.values(dependencies).filter(v => v === 'HEALTHY' || v === true).length;
    const total = Object.keys(dependencies).length || 1;
    score += (ready / total) * 2;
    if (ready < total) reasons.push('some dependencies unhealthy');

    // Cooldown
    const last = this.cooldowns.get(action.id);
    if (last && Date.now() - last < (action.cooldownMs || 60000)) {
      score -= 3;
      reasons.push('recently attempted');
    }

    // Recency of failure
    if (recentFailures.includes(action.id)) {
      score -= 2;
      reasons.push('recent failure');
    }

    // Maintenance suppression
    if (maintenance) {
      score -= 5;
      reasons.push('maintenance mode');
    }

    // Blast radius
    if (action.blastRadius) {
      score -= action.blastRadius;
      reasons.push('blast radius considered');
    }

    return { action: action.id, capabilityId: action.capabilityId, parameters: action.parameters || {}, score: parseFloat(score.toFixed(2)), reasons };
  }

  select(candidates, context = {}) {
    const scored = candidates
      .map(a => this.score(a, { ...context, capability: context.registry ? context.registry.get(a.capabilityId) : null }))
      .sort((a, b) => b.score - a.score);
    const chosen = scored[0];
    return { selected: chosen, alternatives: scored.slice(1) };
  }

  recordAttempt(actionId, timestamp = Date.now()) {
    this.cooldowns.set(actionId, timestamp);
  }

  getHistory() {
    return [...this.history];
  }
}

module.exports = { ActionSelector };
