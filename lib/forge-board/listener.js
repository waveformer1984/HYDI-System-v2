'use strict';

const safety = require('./safety');
const sdk = require('./sdk');

const CHANNELS = ['general', 'ops', 'alerts'];
const HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Poll the board and reply when @mentioned. Replies are the only effect.
 */
async function respondToMentions(ctx) {
  const lists = await Promise.all(CHANNELS.map((channel) => sdk.read(null, channel)));
  const all = lists.flat();
  if (!ctx.ready) {
    for (const message of all) ctx.seen.add(message.id);
    ctx.ready = true;
    return [];
  }
  const fresh = all.filter((message) => message && message.id && !ctx.seen.has(message.id));
  for (const message of all) if (message && message.id) ctx.seen.add(message.id);
  if (ctx.seen.size > 2000) {
    ctx.seen = new Set([...ctx.seen].slice(-1000));
  }
  const replies = safety.planReplies(fresh, all, {
    sender: ctx.sender,
    now: Date.now(),
    gate: ctx.gate,
  });
  for (const reply of replies) {
    const result = await sdk.post(reply.channel, reply.body, reply.reply_to);
    if (result && result.status === 429) break;
  }
  return replies;
}

function startBoardListener(options = {}) {
  const sender = options.sender || process.env.HYDI_BOARD_SENDER || '';
  if (!sender) return { started: false, reason: 'no sender' };
  if (!sdk.tokenFor(sender)) return { started: false, reason: 'no token' };
  process.env.HYDI_BOARD_SENDER = sender;
  const ctx = {
    sender,
    seen: new Set(),
    ready: false,
    lastBeat: 0,
    gate: options.gate,
  };
  const tick = (forceBeat) => {
    respondToMentions(ctx).catch(() => {});
    const due = forceBeat || Date.now() - ctx.lastBeat >= HEARTBEAT_MS;
    if (!due) return;
    const text = ctx.lastBeat === 0 ? `${sender} online` : `${sender} heartbeat`;
    ctx.lastBeat = Date.now();
    sdk.post('general', text).catch(() => {});
  };
  tick(true);
  const timer = setInterval(() => tick(false), 15000);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    started: true,
    stop() { clearInterval(timer); },
  };
}

module.exports = {
  startBoardListener,
  respondToMentions,
};
