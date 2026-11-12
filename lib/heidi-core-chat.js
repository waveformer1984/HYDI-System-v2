'use strict';

/**
 * Dashboard chat → Heidi Core (memory + tools).
 *
 * heidi-core's /chat-tools is the conversation-aware brain: it keeps the
 * turn history and long-term memories in heidi-core/data/heidi_memory.db,
 * scoped by owner (docs/HEIDI_PERSISTENT_MEMORY.md). The phone chat on :3006
 * already talks to it (launch-heidi-mobile.js). This module gives the
 * dashboard's /api/chat the same path, so both surfaces share one memory.
 *
 * streamChat() never throws. It returns:
 *   { ok: true,  conversationId, model, persistence, toolsUsed }   text was streamed
 *   { ok: false, conversationNotFound: true }                      unknown conversation id
 *   { ok: false, reason }                                          core down / no text
 * When ok is false nothing has been sent through onText, so the caller can
 * fall back to another path without splicing two replies together.
 */

const DEFAULT_URL = 'http://localhost:3459';
// Shared deadline across /chat-tools AND /think-stream. 30s is the budget a
// phone chat can afford before the caller's own busy-timeout fires; the old
// 180s let a wedged core silence the client for minutes.
const TIMEOUT_MS = 30 * 1000;
const PATHS = ['/chat-tools', '/think-stream'];

function coreUrl(env = process.env) {
  return String(env.HEIDI_CORE_URL || DEFAULT_URL).replace(/\/+$/, '');
}

/** Read one SSE response body, calling onEvent for every parsed data: line. */
async function readSse(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop();
    for (const ev of events) {
      const line = ev.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let data;
      try { data = JSON.parse(line.slice(6)); } catch { continue; }
      if (onEvent(data) === false) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return;
      }
    }
  }
}

/**
 * @param {{
 *   message: string,
 *   conversationId?: string|null,
 *   requestId?: string|null,
 *   onText: (text: string) => void,
 *   fetchImpl?: typeof fetch,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<{ ok: boolean, conversationNotFound?: boolean, reason?: string,
 *   conversationId?: string|null, model?: string, persistence?: any, toolsUsed?: string[] }>}
 */
async function streamChat({
  message,
  conversationId = null,
  requestId = null,
  onText,
  fetchImpl = fetch,
  baseUrl = coreUrl(),
  timeoutMs = TIMEOUT_MS,
}) {
  let lastReason = 'heidi-core unreachable';
  // One deadline across BOTH paths — the phone cannot wait 2×timeoutMs.
  const deadline = Date.now() + timeoutMs;
  for (const path of PATHS) {
    // heidi-core sends tokens as { t } and names the model only on the final
    // { done } event, so text is held until then: its `fallback` model is a
    // canned apology, not Heidi with memory, and must not reach the user
    // ahead of the legacy path's real answer.
    const pending = [];
    let meta = null;
    let notFound = false;
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: message,
          conversation_id: conversationId || undefined,
          request_id: requestId || undefined,
        }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      if (!res.ok || !res.body) {
        lastReason = `heidi-core ${path} answered ${res.status}`;
        continue;
      }
      await readSse(res.body, (d) => {
        if (d.conversation_not_found) { notFound = true; return false; }
        if (typeof d.t === 'string') pending.push(d.t);
        if (d.done) { meta = d; return false; }
        return true;
      });
    } catch (error) {
      lastReason = `heidi-core ${path}: ${error && error.message ? error.message : 'request failed'}`;
      continue;
    }
    if (notFound) return { ok: false, conversationNotFound: true };
    if (meta && meta.model !== 'fallback' && pending.length) {
      for (const t of pending) onText(t);
      return {
        ok: true,
        conversationId: meta.conversation_id || conversationId || null,
        model: meta.model || 'heidi-core',
        persistence: meta.persistence || null,
        toolsUsed: Array.isArray(meta.tools_used) ? meta.tools_used : [],
      };
    }
    lastReason = meta && meta.model === 'fallback'
      ? 'heidi-core had no model available (fallback reply)'
      : `heidi-core ${path} returned no complete reply`;
  }
  return { ok: false, reason: lastReason };
}

/**
 * The last `limit` messages of a conversation, oldest first, as
 * { role, content, created_at }. Returns null when the conversation is
 * unknown (or not this owner's) and throws when heidi-core is unreachable.
 */
/**
 * @param {{ conversationId: string, limit?: number, fetchImpl?: typeof fetch, baseUrl?: string }} opts
 * @returns {Promise<Array<{ role: string, content: string, created_at: string|null }>|null>}
 */
async function fetchHistory({ conversationId, limit = 50, fetchImpl = fetch, baseUrl = coreUrl() }) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const res = await fetchImpl(`${baseUrl}/conversations/${encodeURIComponent(conversationId)}/messages?limit=${n}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`heidi-core answered ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content, created_at: m.created_at || null }));
}

module.exports = { streamChat, fetchHistory, coreUrl };
