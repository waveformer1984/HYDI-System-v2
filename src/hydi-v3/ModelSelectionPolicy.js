'use strict';

const { CAPABILITIES } = require('./ModelCapabilities');

const DEFAULT_RULES = {
  simple_task: { prefer: 'fast', maxLatencyMs: 500, capability: CAPABILITIES.CHAT },
  reasoning_task: { prefer: 'large', minContext: 4096, capability: CAPABILITIES.REASONING },
  embedding_task: { prefer: 'embed', capability: CAPABILITIES.EMBED },
  vision_task: { prefer: 'vision', capability: CAPABILITIES.VISION },
  code_task: { prefer: 'code', capability: CAPABILITIES.CODE },
  high_load: { prefer: 'lightweight', maxMemoryMB: 4000, capability: CAPABILITIES.CHAT },
};

class ModelSelectionPolicy {
  constructor(rules = DEFAULT_RULES) {
    this.rules = rules;
  }

  classify(task) {
    if (this.rules[task]) return task;
    if (task === 'embedding' || task === 'search') return 'embedding_task';
    if (task === 'vision') return 'vision_task';
    if (task === 'codeReview') return 'code_task';
    if (task === 'planning' || task === 'rag' || task === 'summarization') return 'reasoning_task';
    if (task === 'intentExtraction' || task === 'conversation') return 'simple_task';
    return 'simple_task';
  }

  apply(task, candidates, _resources = {}) {
    const ruleKey = this.classify(task);
    const rule = this.rules[ruleKey] || this.rules.simple_task;
    let list = candidates.slice();

    // Capability filter
    list = list.filter((m) => (m.capabilities || []).includes(rule.capability));

    // Context filter for reasoning
    if (rule.minContext) {
      list = list.filter((m) => (m.contextSize || 0) >= rule.minContext);
    }

    // Memory filter for high load / lightweight
    if (rule.maxMemoryMB) {
      list = list.filter((m) => (m.size || 0) < rule.maxMemoryMB * 1024 * 1024);
    }

    if (list.length === 0) return null;

    // Prefer requested profile
    const profile = rule.prefer;
    list.sort((a, b) => {
      const score = (m) => {
        let s = 0;
        if (profile === 'fast' && /(tiny|small|fast)/.test(m.id)) s += 10;
        if (profile === 'large' && /(7|13|70)b/.test(m.id)) s += 10;
        if (profile === 'lightweight' && (m.size || Infinity) < 2_000_000_000) s += 10;
        if (profile === 'embed' && (m.capabilities || []).includes(CAPABILITIES.EMBED)) s += 20;
        if (profile === 'vision' && (m.capabilities || []).includes(CAPABILITIES.VISION)) s += 20;
        if (profile === 'code' && (m.capabilities || []).includes(CAPABILITIES.CODE)) s += 20;
        if (m.healthy) s += 5;
        s -= ((m.avgLatency || 0) / 1000);
        return s;
      };
      return score(b) - score(a);
    });
    return list[0];
  }
}

module.exports = ModelSelectionPolicy;
