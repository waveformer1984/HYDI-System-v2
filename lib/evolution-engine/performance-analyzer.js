'use strict';

const { assess } = require('../../evolution/self-assessment');

/**
 * Wraps evolution/self-assessment for pipeline/event performance trends.
 */
class PerformanceAnalyzer {
  /**
   * @param {Array<object>} events
   * @param {object} [opts]
   */
  analyzeEvents(events, opts = {}) {
    return assess(events, opts);
  }
}

module.exports = { PerformanceAnalyzer };
