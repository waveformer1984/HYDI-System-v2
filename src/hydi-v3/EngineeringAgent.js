'use strict';

const BaseAgent = require('./BaseAgent');

class EngineeringAgent extends BaseAgent {
  constructor(config = {}) {
    super({ ...config, name: 'EngineeringAgent' });
  }

  async analyze(repositoryContext = '') {
    this._log('analyze', { repositoryContextLength: repositoryContext.length });
    const prompt = `You are an engineering lead. Inspect the repository context and identify the top 3 technical-debt items, test-coverage gaps, or architecture concerns. Return structured bullet points only; do not propose code changes.\n\nContext:\n${repositoryContext || 'No repository context supplied.'}`;
    const result = await this._ask(prompt);
    return { agent: this.name, findings: result.text };
  }
}

module.exports = EngineeringAgent;
