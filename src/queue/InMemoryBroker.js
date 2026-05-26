'use strict';

const { EventEmitter } = require('events');
const MessageBroker = require('./MessageBroker');

/**
 * Zero-dependency in-process broker for tests and offline development.
 * Eliminates Redis ECONNREFUSED errors in Jest — just set BROKER_TRANSPORT=memory.
 *
 * Semantics:
 *  - publish() delivers immediately via setImmediate to all subscribed groups
 *  - ack() removes message from the group's pending map
 *  - nack() re-delivers via setImmediate
 *  - destroy() clears all state — call in afterEach to prevent cross-test bleed
 */
class InMemoryBroker extends MessageBroker {
  constructor(config = {}) {
    super(config);
    this._messages = new Map();   // topic → [{ id, message }]
    this._groups   = new Map();   // `${topic}:${group}` → { cursor, pending: Map<id, msg> }
    this._handlers = new Map();   // `${topic}:${group}` → handler fn
    this._emitter  = new EventEmitter();
    this._emitter.setMaxListeners(0);
  }

  async connect() {
    this._connected = true;
  }

  async disconnect() {
    this._connected = false;
  }

  /**
   * @param {string} topic
   * @param {import('./MessageBroker').HYDIEvent} message
   * @param {import('./MessageBroker').PublishOptions} [options]
   * @returns {Promise<string>}
   */
  async publish(topic, message, options = {}) {
    if (!this._messages.has(topic)) this._messages.set(topic, []);
    const id = message.id || `mem-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    const entry = { id, message: { ...message, id } };
    this._messages.get(topic).push(entry);
    setImmediate(() => {
      if (!this._destroyed) this._fanoutToGroups(topic, entry);
    });
    return id;
  }

  /**
   * @param {string} topic
   * @param {string} consumerGroup
   * @param {(event: import('./MessageBroker').HYDIEvent) => Promise<void>} handler
   */
  subscribe(topic, consumerGroup, handler) {
    const key = `${topic}:${consumerGroup}`;
    this._handlers.set(key, handler);
    if (!this._groups.has(key)) {
      this._groups.set(key, { cursor: 0, pending: new Map() });
    }
    // deliver any already-published messages this group hasn't seen
    const msgs = this._messages.get(topic) || [];
    const group = this._groups.get(key);
    for (let i = group.cursor; i < msgs.length; i++) {
      this._deliver(topic, consumerGroup, msgs[i]);
    }
  }

  _fanoutToGroups(topic, entry) {
    for (const key of this._handlers.keys()) {
      if (!key.startsWith(`${topic}:`)) continue;
      const group = key.slice(topic.length + 1);
      this._deliver(topic, group, entry);
    }
  }

  _deliver(topic, consumerGroup, entry) {
    const key = `${topic}:${consumerGroup}`;
    const handler = this._handlers.get(key);
    const group   = this._groups.get(key);
    if (!handler || !group) return;
    const msgs = this._messages.get(topic) || [];
    group.cursor = msgs.length;
    group.pending.set(entry.id, entry.message);
    handler(entry.message)
      .then(() => { group.pending.delete(entry.id); })
      .catch(() => { /* stays in pending; caller should nack explicitly */ });
  }

  async ack(topic, consumerGroup, messageId) {
    const group = this._groups.get(`${topic}:${consumerGroup}`);
    if (group) group.pending.delete(messageId);
  }

  async nack(topic, consumerGroup, messageId) {
    const key     = `${topic}:${consumerGroup}`;
    const group   = this._groups.get(key);
    const handler = this._handlers.get(key);
    if (!group || !handler) return;
    const message = group.pending.get(messageId);
    if (!message) return;
    setImmediate(() => {
      if (!this._destroyed) {
        handler(message).catch(() => {});
      }
    });
  }

  destroy() {
    super.destroy();
    this._handlers.clear();
    this._groups.clear();
    this._messages.clear();
    this._emitter.removeAllListeners();
  }
}

module.exports = InMemoryBroker;
