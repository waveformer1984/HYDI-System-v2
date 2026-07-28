'use strict';

class VisionAdapter {
  constructor(config = {}) {
    this.name = config.name || 'vision';
    this.modelRouter = config.modelRouter || null;
    this.logger = config.logger || console;
  }

  async observe(imageInput, prompt = 'Describe what you see.') {
    if (!this.modelRouter || !this.modelRouter.modelManager) {
      return { ok: false, text: 'Vision model not available.' };
    }
    const result = await this.modelRouter.modelManager.vision(imageInput, prompt);
    if (result.ok) this._emitSignal(result.text);
    return result;
  }

  _emitSignal(observation) {
    // Placeholder: vision observations become BusinessSignals without changing architecture.
    this.logger.log('[VisionAdapter] signal', { observation: observation.slice(0, 120) });
  }
}

module.exports = VisionAdapter;
