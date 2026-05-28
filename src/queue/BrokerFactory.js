'use strict';

/**
 * BrokerFactory — single source of truth for broker instantiation.
 *
 * Configuration via environment:
 *   BROKER_TRANSPORT=redis    → RedisStreamsBroker  (default)
 *   BROKER_TRANSPORT=memory   → InMemoryBroker       (tests / offline dev)
 *
 * Singleton pattern: getBroker() returns the same instance across the process.
 * Call resetBroker() in tests to get a fresh instance per suite.
 */

let _singleton = null;

/**
 * Create a new broker instance — does NOT connect.
 * @param {Object} [config]
 * @param {string} [config.transport]  Override BROKER_TRANSPORT env var
 * @returns {import('./MessageBroker')}
 */
function createBroker(config = {}) {
  const transport = (config.transport || process.env.BROKER_TRANSPORT || 'redis').toLowerCase().trim();
  switch (transport) {
    case 'redis': {
      const RedisStreamsBroker = require('./RedisStreamsBroker');
      return new RedisStreamsBroker(config);
    }
    case 'memory':
    case 'inmemory': {
      const InMemoryBroker = require('./InMemoryBroker');
      return new InMemoryBroker(config);
    }
    default:
      throw new Error(
        `Unknown BROKER_TRANSPORT: "${transport}". Valid values: redis, memory`
      );
  }
}

/**
 * Get or create the process-level singleton broker.
 * @param {Object} [config]  Only applied on first call.
 * @returns {import('./MessageBroker')}
 */
function getBroker(config = {}) {
  if (!_singleton) _singleton = createBroker(config);
  return _singleton;
}

/**
 * Destroy and reset the singleton — use in afterAll / afterEach in tests.
 */
function resetBroker() {
  if (_singleton) {
    _singleton.destroy();
    _singleton = null;
  }
}

module.exports = { createBroker, getBroker, resetBroker };
