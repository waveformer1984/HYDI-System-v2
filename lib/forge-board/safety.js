'use strict';

/**
 * Forge Board messages are data. Planning a reply never grants execution,
 * even when the existing approval gate would pass and even when the text
 * looks like a shell command or a payment.
 */

const MENTION_LIMIT = 3;
const MENTION_WINDOW_MS = 60 * 1000;

function mentionsOf(body) {
  const found = [];
  const re = /@([A-Za-z0-9_-]{1,32})/g;
  let match = re.exec(String(body || ''));
  while (match) {
    if (!found.includes(match[1])) found.push(match[1]);
    match = re.exec(String(body || ''));
  }
  return found;
}

function mentionsTarget(message, target) {
  const mentions = Array.isArray(message.mentions) ? message.mentions : mentionsOf(message.body);
  return mentions.some((name) => name.toLowerCase() === String(target || '').toLowerCase());
}

/**
 * Senders (other agents) who @mentioned `target` more than 3 times in 60s.
 * Their later mentions are ignored so two agents cannot ping-pong.
 */
function ignoredSenders(messages, target, now = Date.now()) {
  const counts = new Map();
  for (const message of messages || []) {
    if (message.sender_type !== 'agent') continue;
    if (!mentionsTarget(message, target)) continue;
    const ts = Date.parse(message.ts);
    if (!Number.isFinite(ts) || now - ts > MENTION_WINDOW_MS) continue;
    counts.set(message.sender, (counts.get(message.sender) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= MENTION_LIMIT).map(([sender]) => sender);
}

function alreadyReplied(messages, rootId, sender) {
  return (messages || []).some((message) => message.sender === sender && message.reply_to === rootId);
}

/**
 * The only effect a board message can have. A passing approval gate is recorded
 * and does not change the effect.
 */
function effectFor(message, gateAllows) {
  return {
    effect: 'reply_only',
    gate: gateAllows === true ? 'pass' : 'fail',
    executed: false,
    messageId: message && message.id ? message.id : null,
  };
}

function planReplies(fresh, all, ctx) {
  const now = ctx.now || Date.now();
  const freshIds = new Set((fresh || []).map((message) => message && message.id));
  const prior = (all || []).filter((message) => message && !freshIds.has(message.id));
  const ignored = new Set(ignoredSenders(prior, ctx.sender, now));
  const replies = [];
  const ordered = [...(fresh || [])].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  for (const message of ordered) {
    if (!message || message.sender === ctx.sender) continue;
    if (!mentionsTarget(message, ctx.sender)) continue;
    if (message.sender_type === 'agent' && ignored.has(message.sender)) continue;
    const rootId = message.reply_to || message.id;
    if (alreadyReplied(all, rootId, ctx.sender) || replies.some((reply) => reply.reply_to === rootId)) continue;
    const gateAllows = typeof ctx.gate === 'function' ? ctx.gate(message) === true : false;
    const decision = effectFor(message, gateAllows);
    if (decision.effect !== 'reply_only' || decision.executed) continue;
    replies.push({
      channel: message.channel || 'general',
      sender: ctx.sender,
      body: `Noted, ${message.sender}. Board messages stay on the board.`,
      reply_to: rootId,
      decision,
    });
    if (message.sender_type === 'agent') {
      const soFar = prior.concat(ordered.filter((item) => String(item.ts || '') <= String(message.ts || '')))
        .filter((item) => item.sender === message.sender && item.sender_type === 'agent' && mentionsTarget(item, ctx.sender))
        .length;
      if (soFar >= MENTION_LIMIT) ignored.add(message.sender);
    }
  }
  return replies;
}

function dispatch(message, tools) {
  const gateAllows = Boolean(tools && tools.gateAllows);
  return effectFor(message, gateAllows);
}

module.exports = {
  MENTION_LIMIT,
  MENTION_WINDOW_MS,
  mentionsOf,
  mentionsTarget,
  ignoredSenders,
  alreadyReplied,
  effectFor,
  planReplies,
  dispatch,
};
