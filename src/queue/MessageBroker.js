'use strict';

/**
 * @typedef {Object} HYDIEvent
 * @property {string} id
 * @property {string} type
 * @property {string} source
 * @property {number} timestamp
 * @property {string|null} correlationId
 * @property {string|null} userId
 * @property {Object} payload
 * @property {string} version
 */

/**
 * @typedef {Object} PublishOptions
 * @property {string} [correlationId]
 * @property {string} [userId]
 * @property {number} [maxLen]  Redis MAXLEN approximate trimming
 */

/**
 * Abstract base class for all HYDI message broker adapters.
 * Swap the transport layer by changing BROKER_TRANSPORT — never by touching orchestration code.
 */
class MessageBroker {
  constructor(config = {}) {
    if (new.target === MessageBroker) {
      throw new Error('MessageBroker is abstract — instantiate a concrete adapter via BrokerFactory');
    }
    this.config = config;
    this._connected = false;
    this._destroyed = false;
  }

  /** @returns {Promise<void>} */
  async connect() { throw new Error('Not implemented: connect()'); }

  /** @returns {Promise<void>} */
  async disconnect() { throw new Error('Not implemented: disconnect()'); }

  /** @returns {boolean} */
  isConnected() { return this._connected; }

  /**
   * Publish an event to a topic.
   * @param {string} topic
   * @param {HYDIEvent} message
   * @param {PublishOptions} [options]
   * @returns {Promise<string>} messageId assigned by the broker
   */
  async publish(topic, message, options = {}) {
    throw new Error('Not implemented: publish()');
  }

  /**
   * Subscribe a consumer group to a topic.
   * Handler is called for every delivered message; throw or reject to nack.
   * @param {string} topic
   * @param {string} consumerGroup
   * @param {(event: HYDIEvent) => Promise<void>} handler
   */
  subscribe(topic, consumerGroup, handler) {
    throw new Error('Not implemented: subscribe()');
  }

  /**
   * Acknowledge successful processing of a message.
   * @param {string} topic
   * @param {string} consumerGroup
   * @param {string} messageId
   * @returns {Promise<void>}
   */
  async ack(topic, consumerGroup, messageId) {
    throw new Error('Not implemented: ack()');
  }

  /**
   * Negative-acknowledge — signal the message should be redelivered.
   * @param {string} topic
   * @param {string} consumerGroup
   * @param {string} messageId
   * @returns {Promise<void>}
   */
  async nack(topic, consumerGroup, messageId) {
    throw new Error('Not implemented: nack()');
  }

  /** Tear down all connections and timers. Safe to call multiple times. */
  destroy() {
    this._destroyed = true;
    this._connected = false;
  }
}

module.exports = MessageBroker;
