/**
 * REDIS STREAM BROKER
 * Thin Upstash Redis REST client for async pub/sub between HYDI subsystems.
 * Uses raw fetch (no SDK) — consistent with the rest of this repo.
 *
 * Streams used:
 *   hydi:task-results   — completed loop outcomes
 *   hydi:task-failures  — failed loop outcomes (triggers self-healing)
 *   hydi:edge-tasks     — tasks dispatched to Termux edge nodes
 *   hydi:edge-results   — results returned from edge nodes
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCommand(...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    // Silent no-op when Redis is not configured — avoids crashing the loop
    return null;
  }
  try {
    const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join('/')}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.warn(`[REDIS] Command failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.result ?? null;
  } catch (e) {
    console.warn(`[REDIS] Command error: ${e.message}`);
    return null;
  }
}

async function redisPost(command) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.warn(`[REDIS] POST failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.result ?? null;
  } catch (e) {
    console.warn(`[REDIS] POST error: ${e.message}`);
    return null;
  }
}

class RedisStreamBroker {
  /**
   * Publish a message to a Redis stream via XADD.
   * @param {string} stream - Stream key (e.g. 'hydi:task-results')
   * @param {object} payload - JSON-serialisable object
   * @returns {Promise<string|null>} Message ID or null on failure
   */
  async publish(stream, payload) {
    const fields = ['data', JSON.stringify(payload)];
    // XADD stream * field value
    return redisPost(['XADD', stream, '*', ...fields]);
  }

  /**
   * Create a consumer group (idempotent — ignores BUSYGROUP error).
   * @param {string} stream
   * @param {string} group
   */
  async createGroup(stream, group) {
    // XGROUP CREATE stream group $ MKSTREAM
    return redisPost(['XGROUP', 'CREATE', stream, group, '$', 'MKSTREAM']).catch(() => null);
  }

  /**
   * Read pending messages from a stream as a consumer group member.
   * @param {string} stream
   * @param {string} group
   * @param {string} consumer - Unique consumer name
   * @param {number} count
   * @returns {Promise<Array<{id: string, data: object}>|null>}
   */
  async consume(stream, group, consumer, count = 10) {
    const result = await redisPost([
      'XREADGROUP', 'GROUP', group, consumer,
      'COUNT', String(count), 'BLOCK', '0', 'STREAMS', stream, '>',
    ]);
    if (!result || !Array.isArray(result)) return [];
    // result is [[streamName, [[id, fields], ...]]]
    const messages = result[0]?.[1] ?? [];
    return messages.map(([id, fields]) => {
      const dataIdx = fields.indexOf('data');
      let data = {};
      if (dataIdx !== -1) {
        try { data = JSON.parse(fields[dataIdx + 1]); } catch { data = {}; }
      }
      return { id, data };
    });
  }

  /**
   * Acknowledge a processed message.
   * @param {string} stream
   * @param {string} group
   * @param {string} messageId
   */
  async ack(stream, group, messageId) {
    return redisPost(['XACK', stream, group, messageId]);
  }

  /**
   * Read the latest N entries from a stream (no group — for polling/monitoring).
   * @param {string} stream
   * @param {number} count
   * @returns {Promise<Array<{id: string, data: object}>>}
   */
  async peek(stream, count = 10) {
    const result = await redisPost(['XREVRANGE', stream, '+', '-', 'COUNT', String(count)]);
    if (!Array.isArray(result)) return [];
    return result.map(([id, fields]) => {
      const dataIdx = fields.indexOf('data');
      let data = {};
      if (dataIdx !== -1) {
        try { data = JSON.parse(fields[dataIdx + 1]); } catch { data = {}; }
      }
      return { id, data };
    });
  }
}

module.exports = new RedisStreamBroker();
