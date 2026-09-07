'use strict';

const BaseAgent = require('./BaseAgent');

// NAMING COLLISION: there is a SEPARATE, unrelated class also named
// `FinanceAgent` at pao-system/agents/business/finance.agent.ts (the PAO
// business agent). THIS one is scoped to the HYDI V3 reliability layer
// only, extending this directory's own BaseAgent. Check which tree a
// given consumer lives in before assuming which "FinanceAgent" it
// imports.
class FinanceAgent extends BaseAgent {
  constructor(config = {}) {
    super({ ...config, name: 'FinanceAgent' });
  }

  async analyze(metrics = {}) {
    this._log('analyze', { metrics });
    const prompt = `You are a finance analyst. Review the metrics and identify the most important trend or risk. Do not invent numbers; only use the provided data.\n\nMetrics: ${JSON.stringify(metrics, null, 2)}`;
    const result = await this._ask(prompt);
    return { agent: this.name, insight: result.text };
  }
}

module.exports = FinanceAgent;
