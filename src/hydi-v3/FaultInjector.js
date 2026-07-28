'use strict';

const fs = require('fs').promises;

class FaultInjector {
  constructor(config = {}) {
    this.logger = config.logger || console;
  }

  async corruptFile(filePath, mode = 'garble') {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      const corrupted = mode === 'truncate' ? '' : text.split('').reverse().join('') + '!CORRUPT!';
      await fs.writeFile(filePath, corrupted, 'utf8');
      return { success: true, mode };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  makeModelUnavailable(modelManager, modelId) {
    if (!modelManager || !modelManager.markUnavailable) {
      return { success: false, error: 'no_markUnavailable_handler' };
    }
    return modelManager.markUnavailable(modelId);
  }

  injectQueueInconsistency(taskEngine) {
    if (!taskEngine || !taskEngine.inject) {
      return { success: false, error: 'no_inject_handler' };
    }
    return taskEngine.inject('queue_inconsistency');
  }

  simulate(type, target) {
    return { injected: true, type, target, at: Date.now() };
  }
}

module.exports = FaultInjector;
