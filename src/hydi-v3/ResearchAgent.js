'use strict';

const BaseAgent = require('./BaseAgent');

class ResearchAgent extends BaseAgent {
  constructor(config = {}) {
    super({ ...config, name: 'ResearchAgent' });
  }

  async analyze(topic) {
    this._log('analyze', { topic });
    const memories = this.businessMemory ? this.businessMemory.find({ query: topic, limit: 10 }).map((m) => JSON.stringify(m)) : [];
    const prompt = `Analyze the following research topic and provide a short summary of opportunities and risks.\n\nTopic: ${topic}\n\nContext:\n${memories.join('\n') || 'No relevant context.'}`;
    const result = await this._ask(prompt);
    return { agent: this.name, topic, summary: result.text, sources: memories.length };
  }
}

module.exports = ResearchAgent;
