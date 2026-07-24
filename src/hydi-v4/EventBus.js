'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

/**
 * EventBus is the kernel's central nervous system.
 *
 * Modules do not communicate directly; they publish and subscribe through the
 * bus. Each event carries a unique id, origin, timestamp, and immutable payload.
 */
class EventBus extends EventEmitter {
  constructor(kernel, options = {}) {
    super();
    this.kernel = kernel;
    this.config = {
      defaultTimeoutMs: options.defaultTimeoutMs || 30000,
      maxListenerDepth: options.maxListenerDepth || 256,
      ...options,
    };
    this.subscriptions = new Map();
    this.requestInboxes = new Map();
    this._started = false;
    this._sequence = 0;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this.emit('started');
  }

  stop() {
    if (!this._started) return;
    this._started = false;
    this.subscriptions.clear();
    this.requestInboxes.clear();
    this.emit('stopped');
  }

  /**
   * Subscribe to a topic. Wildcards are not supported; exact topics only.
   */
  subscribe(topic, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function');
    }
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    const sub = {
      id: randomUUID(),
      handler,
      priority: Number(options.priority) || 0,
      once: !!options.once,
      filter: options.filter || null,
    };
    const list = this.subscriptions.get(topic);
    list.push(sub);
    list.sort((a, b) => b.priority - a.priority);
    return sub.id;
  }

  unsubscribe(topic, handlerOrId) {
    const list = this.subscriptions.get(topic);
    if (!list) return false;
    const idx = list.findIndex(
      (s) => s.id === handlerOrId || s.handler === handlerOrId
    );
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (list.length === 0) this.subscriptions.delete(topic);
    return true;
  }

  async publish(topic, payload = {}, metadata = {}) {
    const event = this._buildEvent(topic, payload, metadata);
    await this.kernel.eventLedger?.append(event);
    this.emit('published', event);
    const list = this.subscriptions.get(topic) || [];
    const results = [];
    for (const sub of list.slice(0, this.config.maxListenerDepth)) {
      if (sub.once) {
        this.unsubscribe(topic, sub.id);
      }
      if (sub.filter && !sub.filter(event)) {
        continue;
      }
      try {
        const result = await sub.handler(event);
        results.push({ status: 'fulfilled', value: result });
      } catch (err) {
        results.push({ status: 'rejected', reason: err.message });
        this.emit('handler_error', { event, subscription: sub.id, error: err.message });
      }
    }
    return { event, results };
  }

  /**
   * Request-response over the bus.
   */
  async request(topic, payload = {}, options = {}) {
    const responseTopic = `response:${randomUUID()}`;
    const timeoutMs = options.timeoutMs || this.config.defaultTimeoutMs;
    const requestEvent = this._buildEvent(topic, payload, {
      ...options,
      responseTopic,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.unsubscribe(responseTopic, handler);
        reject(new Error(`request timed out: ${topic}`));
      }, timeoutMs);

      const handler = (event) => {
        clearTimeout(timer);
        if (event.payload?._error) {
          reject(new Error(event.payload._error));
        } else {
          resolve(event.payload);
        }
      };

      this.subscribe(responseTopic, handler, { once: true });
      this.publish(topic, requestEvent.payload, requestEvent.metadata).catch((err) => {
        clearTimeout(timer);
        this.unsubscribe(responseTopic, handler);
        reject(err);
      });
    });
  }

  reply(requestEvent, payload) {
    const topic = requestEvent.metadata?.responseTopic;
    if (!topic) throw new Error('request event has no responseTopic');
    return this.publish(topic, payload, { origin: 'kernel' });
  }

  _buildEvent(topic, payload, metadata = {}) {
    this._sequence += 1;
    return {
      id: randomUUID(),
      version: '1.0',
      topic,
      timestamp: new Date().toISOString(),
      sequence: this._sequence,
      origin: metadata.origin || 'kernel',
      payload,
      metadata,
    };
  }
}

module.exports = EventBus;
