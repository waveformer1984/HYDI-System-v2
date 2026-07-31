'use strict';

const BaseAgent = require('./BaseAgent');

class ProductAgent extends BaseAgent {
  constructor(config = {}) {
    super({ ...config, name: 'ProductAgent' });
  }

  async analyze() {
    this._log('analyze', {});
    const memories = this.businessMemory ? this.businessMemory.find({ limit: 20 }).map((m) => JSON.stringify(m)) : [];
    const prompt = `You are a product strategist. Given the business memory, identify the most important feature opportunity and the biggest roadmap risk. Return a concise recommendation, not an execution plan.\n\nContext:\n${memories.join('\n') || 'No business memory.'}`;
    const result = await this._ask(prompt);
    return { agent: this.name, recommendation: result.text };
  }
}

module.exports = ProductAgent;
