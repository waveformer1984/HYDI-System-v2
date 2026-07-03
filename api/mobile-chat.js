/**
 * Mobile Chat Endpoint — connects the mobile chat UI
 * (public/heidi-mobile-chat.html) to the same backend every other
 * client uses: the universal chat router's system handlers.
 *
 * Speaks the mobile UI's SSE protocol:
 *   data: {"t":"<token>"}    — response text
 *   data: {"done":true,...}  — final frame with provider/system metadata
 *
 * Runs server-side in the same trust domain as api/chat/route.js, so it
 * dispatches to the shared systemHandlers directly instead of minting a
 * service token and calling itself over HTTP. Remote bridges (e.g.
 * launch-heidi-mobile.js) go through /api/chat with an HMAC token instead.
 */

import { systemHandlers } from './chat/route.js';
import { parseSystemMessage } from '../lib/mobile/system-router.js';

const DEFAULT_SYSTEM = 'heidi';

function responseToText(response) {
  if (typeof response === 'string') return response;
  if (response && typeof response.text === 'string') {
    const suffix = response.taskId ? `\n(task: ${response.taskId})` : '';
    return response.text + suffix;
  }
  return JSON.stringify(response, null, 2);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, system } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const routed = parseSystemMessage(message, system);
  const targetSystem = routed.system || DEFAULT_SYSTEM;
  const systemHandler = systemHandlers[targetSystem];
  if (!systemHandler) {
    return res.status(400).json({ error: `Unknown system: ${targetSystem}` });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const response = await systemHandler(routed.text, req);
    send({ t: responseToText(response) });
    send({ done: true, provider: 'hydi', system: targetSystem });
  } catch (error) {
    console.error('[mobile-chat] handler error:', error);
    send({ t: `⚠️ ${targetSystem} error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    send({ done: true, provider: 'hydi', system: targetSystem, error: true });
  }

  res.end();
}
