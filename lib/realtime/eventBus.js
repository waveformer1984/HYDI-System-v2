'use strict';

/**
 * Process-wide event bus for live status/notification broadcast.
 *
 * This deployment runs as a single long-lived Node process (per
 * CLAUDE.md's Local-First Architecture note — Vercel's serverless deploy
 * is dormant), matching the same assumption lib/rate-limit.js documents
 * for its in-memory Map. A plain EventEmitter singleton is therefore the
 * correct "no polling-only architecture" mechanism here: api/heartbeat.js
 * and workers/WorkerOrchestrator.js emit onto it, api/events/stream.js's
 * SSE handler subscribes and forwards to connected clients. If this ever
 * needs to run across multiple processes/instances, this is the file to
 * replace with a real pub/sub (Postgres LISTEN/NOTIFY, Redis, etc.) —
 * every other module only depends on the emit/on/off shape below.
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(100); // many concurrent mobile SSE clients is expected

function publish(type, data) {
  bus.emit('event', { type, ...data, timestamp: new Date().toISOString() });
}

module.exports = { bus, publish };
