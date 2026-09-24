// Heidi Mobile chat — streams a reply from HYDI's own chat endpoint
// (pages/api/chat.ts: live-state answers, the tool-using agent, or the
// orchestrator fallback) back to the phone as a small, validated SSE
// vocabulary: delta | tool | meta | actions | error | done.
//
// Guarantees the phone can rely on:
//   - every stream ends with exactly one `done` or `error` event;
//   - an upstream failure is reported as an error, never as a reply;
//   - closing the connection on the phone (Cancel) aborts the upstream call;
//   - a stalled model is cut off (IDLE_TIMEOUT_MS) rather than hanging.
//
// pages/api/chat.ts does not itself authenticate, so this route checks the
// device's approval with HYDI (cached briefly — see ensureDeviceApproved)
// before relaying anything.

import { guard, sendUpstreamFailure, ensureDeviceApproved } from '../../../lib/heidi-mobile/guard.js';
import { normalizeChatEvent } from '../../../lib/heidi-mobile/normalize.js';
import { createSseParser, parseJsonData } from '../../../lib/heidi-mobile/sseParser';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

const MAX_MESSAGE_LENGTH = 4000;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TOTAL_TIMEOUT_MS = 180 * 1000;
const IDLE_TIMEOUT_MS = 90 * 1000;
const KEEPALIVE_MS = 15 * 1000;

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['POST'], routeName: 'chat', rateMax: 20 });
  if (!g.ok) return;

  const { message, session_id: sessionId } = req.body || {};
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return res.status(400).json({ error: 'empty_message', message: 'Type a message first.' });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'message_too_long', message: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` });
  }
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'invalid_session', message: 'session_id is missing or malformed.' });
  }

  const approval = await ensureDeviceApproved(g.session, g.client);
  if (!approval.ok) return sendUpstreamFailure(res, approval);

  const cancel = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true;
      cancel.abort();
    }
  });

  let idleTimedOut = false;
  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleTimedOut = true; cancel.abort(); }, IDLE_TIMEOUT_MS);
  };
  armIdle();

  const upstream = await g.client.raw('/api/chat', {
    method: 'POST',
    body: { message: text, session_id: `heidi-mobile-${sessionId}`, user_id: `heidi-mobile:${g.session.deviceId}` },
    signal: cancel.signal,
    timeoutMs: TOTAL_TIMEOUT_MS,
    extraHeaders: { Accept: 'text/event-stream' },
  });

  if (!upstream.ok) {
    clearTimeout(idleTimer);
    if (clientGone) return;
    if (idleTimedOut) return res.status(504).json({ error: 'timeout', message: 'HYDI did not start replying in time.' });
    return sendUpstreamFailure(res, upstream);
  }

  const { response } = upstream;
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
    clearTimeout(idleTimer);
    upstream.release();
    let detail = {};
    try { detail = JSON.parse(await response.text()); } catch (_) { /* non-JSON error body */ }
    if (response.ok) return res.status(502).json({ error: 'malformed', message: 'HYDI chat did not return a stream.' });
    const status = response.status >= 500 ? 502 : response.status === 401 ? 401 : response.status === 403 ? 403 : 400;
    return res.status(status).json({
      error: response.status >= 500 ? 'server' : 'client',
      message: typeof detail.message === 'string' ? detail.message.slice(0, 300)
        : typeof detail.error === 'string' ? detail.error.slice(0, 300) : `HYDI chat returned HTTP ${response.status}`,
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform stops Next's gzip middleware from buffering the stream.
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let finished = false;
  const send = (event) => {
    if (finished || clientGone) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const finish = (event) => {
    if (finished) return;
    send(event);
    finished = true;
    res.end();
  };

  const keepalive = setInterval(() => { if (!finished && !clientGone) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
  let malformed = 0;
  let sawContent = false;

  const parser = createSseParser(({ data }) => {
    if (finished) return;
    if (data === '[DONE]') {
      finish({ type: 'done' });
      return;
    }
    const payload = parseJsonData(data);
    const event = normalizeChatEvent(payload);
    if (!event) {
      malformed += 1;
      return;
    }
    if (event.type === 'error') {
      finish(event);
      return;
    }
    if (event.type === 'delta') sawContent = true;
    send(event);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Don't rely on the fetch implementation erroring the body on abort:
  // cancelling the reader directly guarantees the read loop below unblocks.
  cancel.signal.addEventListener('abort', () => { reader.cancel().catch(() => { /* already closed */ }); }, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      parser.push(decoder.decode(value, { stream: true }));
      if (finished) break;
    }
    parser.flush();
    if (!finished) {
      finish({
        type: 'error',
        kind: 'incomplete',
        message: sawContent
          ? 'HYDI closed the connection before finishing this reply.'
          : malformed ? 'HYDI sent a reply Heidi could not read.' : 'HYDI closed the connection without replying.',
      });
    }
  } catch (_) {
    if (!clientGone) {
      const timedOut = idleTimedOut || upstream.timedOut();
      finish({
        type: 'error',
        kind: timedOut ? 'timeout' : 'network',
        message: timedOut ? 'HYDI stopped responding, so the reply was cut off.' : 'Lost the connection to HYDI mid-reply.',
      });
    }
  } finally {
    clearInterval(keepalive);
    clearTimeout(idleTimer);
    upstream.release();
    reader.cancel().catch(() => { /* already closed */ });
    if (!finished && !res.writableEnded) res.end();
  }
}
