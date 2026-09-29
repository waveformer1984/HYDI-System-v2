// Heidi Mobile realtime relay — forwards HYDI's existing mobile-ops event
// stream (api/events/stream.js: subsystem status changes, worker command
// outcomes, notifications) to the phone.
//
// Why relay instead of connecting the phone directly: the upstream stream
// authenticates via a token, and a browser EventSource can only carry that
// in the URL. Relaying keeps the device credential server-side (it travels
// in a header, server to server) and lets the phone authenticate with its
// HttpOnly session cookie alone.
//
// Each relayed connection is capped at MAX_LIFETIME_MS. HYDI only checks the
// device at connect time, so recycling the connection is what makes a
// revocation reach a long-lived stream; EventSource reconnects on its own.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { createSseParser, parseJsonData } from '../../../lib/heidi-mobile/sseParser';

const MAX_LIFETIME_MS = 5 * 60 * 1000;
const KEEPALIVE_MS = 20 * 1000;
const EVENT_TYPE_RE = /^[a-z][a-z0-9_]{0,40}$/;

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'events', rateMax: 20 });
  if (!g.ok) return;

  const cancel = new AbortController();
  let clientGone = false;
  res.on('close', () => { clientGone = true; cancel.abort(); });

  const upstream = await g.client.raw('/api/events/stream', {
    signal: cancel.signal,
    timeoutMs: 10000, // connect timeout; cleared once headers arrive
    extraHeaders: { Accept: 'text/event-stream' },
  });
  if (!upstream.ok) {
    if (clientGone) return;
    return sendUpstreamFailure(res, upstream);
  }
  upstream.clearTimer();

  const { response } = upstream;
  if (!response.ok || !(response.headers.get('content-type') || '').includes('text/event-stream') || !response.body) {
    let detail = {};
    try { detail = JSON.parse(await response.text()); } catch (_) { /* non-JSON */ }
    upstream.release();
    const kind = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
      : response.ok ? 'malformed' : response.status >= 500 ? 'server' : 'client';
    return sendUpstreamFailure(res, {
      kind,
      message: typeof detail.error === 'string' ? detail.error.slice(0, 200) : `HYDI event stream unavailable (HTTP ${response.status})`,
      reason: typeof detail.reason === 'string' ? detail.reason.slice(0, 200) : undefined,
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let seq = 0;
  // Everything goes out as the default `message` event with the type in the
  // payload, so the phone needs one onmessage handler rather than a listener
  // per upstream event name (which it cannot know in advance).
  const write = (payload) => {
    if (clientGone) return;
    seq += 1;
    res.write(`id: ${seq}\nretry: 5000\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const parser = createSseParser(({ event, data }) => {
    const payload = parseJsonData(data);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return; // drop malformed
    const type = EVENT_TYPE_RE.test(payload.type) ? payload.type : EVENT_TYPE_RE.test(event) ? event : null;
    if (!type) return;
    if (type === 'heartbeat') {
      write({ type: 'heartbeat', at: new Date().toISOString() });
      return;
    }
    // `connected` echoes the device role; forward only the fact of connection.
    if (type === 'connected') {
      write({ type: 'connected', at: new Date().toISOString() });
      return;
    }
    write({ ...payload, type });
  });

  const keepalive = setInterval(() => { if (!clientGone) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
  const lifetime = setTimeout(() => cancel.abort(), MAX_LIFETIME_MS);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Don't rely on the fetch implementation erroring the body on abort:
  // cancelling the reader directly guarantees the read loop below unblocks.
  cancel.signal.addEventListener('abort', () => { reader.cancel().catch(() => { /* already closed */ }); }, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
  } catch (_) {
    // upstream dropped, lifetime cap hit, or phone disconnected — the phone
    // reconnects (EventSource `retry`) and falls back to polling meanwhile.
  } finally {
    clearInterval(keepalive);
    clearTimeout(lifetime);
    reader.cancel().catch(() => { /* already closed */ });
    upstream.release();
    if (!res.writableEnded) res.end();
  }
}
