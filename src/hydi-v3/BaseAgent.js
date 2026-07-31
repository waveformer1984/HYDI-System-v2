'use strict';

class BaseAgent {
  constructor(config = {}) {
    this.name = config.name || 'agent';
    this.modelRouter = config.modelRouter || null;
    this.memory = config.memory || null;
    this.businessMemory = config.businessMemory || null;
    this.executionGateway = config.executionGateway || null;
    this.audit = config.audit || null;
    this.logger = config.logger || console;
  }

  _log(action, data) {
    const entry = { at: Date.now(), agent: this.name, action, ...data };
    this.logger.log(`[${this.name}]`, entry);
    if (this.audit && typeof this.audit.record === 'function') {
      this.audit.record('agent-activity', entry);
    }
  }

  async _ask(prompt) {
    if (!this.modelRouter) return { text: 'No model router available.' };
    return this.modelRouter.summarize(prompt);
  }

  /**
   * @param {...any} args
   * @returns {Promise<any>}
   */
  async analyze(...args) { // eslint-disable-line no-unused-vars
    throw new Error('analyze() must be implemented by subclass');
  }
}

module.exports = BaseAgent;
