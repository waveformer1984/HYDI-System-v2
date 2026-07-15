'use strict';

const MessageBroker = require('./MessageBroker');

let Redis = null;
try { Redis = require('ioredis'); } catch { /* ioredis not installed */ }

const POLL_INTERVAL_MS = 100;
const BLOCK_MS         = 2000;
const BATCH_SIZE       = 10;

/**
 * Redis Streams adapter implementing the MessageBroker interface.
 *
 * publish  → XADD
 * subscribe → XREADGROUP (polling loop, unref'd timer)
 * ack      → XACK
 * nack     → leave in PEL; Redis redelivers after XAUTOCLAIM timeout
 */
class RedisStreamsBroker extends MessageBroker {
  constructor(config = {}) {
    super(config);
    this._redis        = null;
    this._pollTimers   = new Map();   // `${topic}:${group}` → intervalId
    this._consumerName = config.consumerName || `worker-${process.pid}`;
  }

  async connect() {
    if (!Redis) throw new Error('ioredis is not installed — run: npm install ioredis');
    this._redis = new Redis({
      host:            this.config.host     || process.env.REDIS_HOST     || 'localhost',
      port:            parseInt(this.config.port || process.env.REDIS_PORT || '6379', 10),
      password:        this.config.password || process.env.REDIS_PASSWORD  || undefined,
      lazyConnect:     true,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this._redis.on('error', (err) => {
      if (!this._destroyed) console.error('[BROKER:redis] connection error:', err.message);
    });
    await this._redis.connect();
    this._connected = true;
  }

  async disconnect() {
    this._stopAllPollers();
    if (this._redis) {
      await this._redis.quit().catch(() => {});
      this._redis = null;
    }
    this._connected = false;
  }

  /**
   * @param {string} topic
   * @param {import('./MessageBroker').HYDIEvent} message
   * @param {import('./MessageBroker').PublishOptions} [options]
   * @returns {Promise<string>}
   */
  async publish(topic, message, options = {}) {
    const payload = JSON.stringify(message);
    const streamArgs = options.maxLen
      ? ['XADD', topic, 'MAXLEN', '~', String(options.maxLen), '*', 'data', payload]
      : ['XADD', topic, '*', 'data', payload];
    return this._redis.call(...streamArgs);
  }

  /**
   * @param {string} topic
   * @param {string} consumerGroup
   * @param {(event: import('./MessageBroker').HYDIEvent) => Promise<void>} handler
   */
  subscribe(topic, consumerGroup, handler) {
    this._ensureGroup(topic, consumerGroup)
      .then(() => this._startPoller(topic, consumerGroup, handler))
      .catch((err) => {
        if (!this._destroyed) {
          console.error(`[BROKER:redis] subscribe failed for ${topic}:${consumerGroup}:`, err.message);
        }
      });
  }

  async _ensureGroup(topic, consumerGroup) {
    try {
      await this._redis.call('XGROUP', 'CREATE', topic, consumerGroup, '$', 'MKSTREAM');
    } catch (err) {
      // BUSYGROUP means the group already exists — that's fine
      if (!err.message.includes('BUSYGROUP')) throw err;
    }
  }

  _startPoller(topic, consumerGroup, handler) {
    const key = `${topic}:${consumerGroup}`;
    const poll = async () => {
      if (this._destroyed || !this._connected) return;
      try {
        const results = await this._redis.call(
          'XREADGROUP', 'GROUP', consumerGroup, this._consumerName,
          'COUNT', String(BATCH_SIZE),
          'BLOCK', String(BLOCK_MS),
          'STREAMS', topic, '>'
        );
        if (!results) return;
        for (const [, messages] of results) {
          for (const [msgId, fields] of messages) {
            const dataIdx = fields.indexOf('data');
            if (dataIdx === -1) continue;
            try {
              const event = JSON.parse(fields[dataIdx + 1]);
              await handler(event);
              await this.ack(topic, consumerGroup, msgId);
            } catch {
              // handler threw — message stays in PEL for XAUTOCLAIM redelivery
            }
          }
        }
      } catch (err) {
        if (!this._destroyed) {
          console.error(`[BROKER:redis] poll error ${key}:`, err.message);
        }
      }
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    if (timer.unref) timer.unref();
    this._pollTimers.set(key, timer);
    poll();
  }

  _stopAllPollers() {
    for (const timer of this._pollTimers.values()) clearInterval(timer);
    this._pollTimers.clear();
  }

  async ack(topic, consumerGroup, messageId) {
    await this._redis.call('XACK', topic, consumerGroup, messageId);
  }

  async nack(_topic, _consumerGroup, _messageId) {
    // Intentionally a no-op: not acking leaves the message in the PEL.
    // Redis will redeliver it after the consumer's idle timeout via XAUTOCLAIM.
  }

  destroy() {
    super.destroy();
    this._stopAllPollers();
    if (this._redis) {
      this._redis.disconnect();
      this._redis = null;
    }
  }
}

module.exports = RedisStreamsBroker;
