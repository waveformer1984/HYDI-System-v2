'use strict';

/**
 * Deterministic memory commands for Heidi's chat. They run before any model
 * call, read only the caller's own memory, and report what the store
 * actually did — never a model's guess.
 *
 *   memory status | memory recent | memory audit
 *   memory search <query> | memory forget <id or text>
 *   memory project <hydi|heidi|protoforge> [refresh]
 */

const crypto = require('crypto');
const { refreshProject, describeProject, needsRefresh, ageText, PROJECTS } = require('./project-state');

function parseMemoryCommand(input) {
  const m = /^\s*\/?memory(?:\s+(status|search|recent|project|audit|forget)\b\s*(.*))?\s*$/i.exec(String(input || ''));
  if (!m) return null;
  return { cmd: (m[1] || 'status').toLowerCase(), arg: (m[2] || '').trim() };
}

function fmtMemory(m) {
  return `#${m.id} [${m.category} · ${m.verification} · ${String(m.updated_at).slice(0, 10)}${m.source_conversation_id ? ` · from chat ${String(m.source_conversation_id).slice(0, 8)}` : ''}] ${m.content}`;
}

function since(iso, now) {
  return iso ? ageText(now - Date.parse(iso)) : 'never';
}

/**
 * @param {{ store: any, storeError?: string|null, owner: string, conversationId?: string|null,
 *   cmd: string, arg: string, lastTurn?: any, diagnostics?: () => Promise<any>, root?: string, git?: Function, now?: number }} ctx
 */
async function runMemoryCommand(ctx) {
  const now = ctx.now || Date.now();
  const { store, owner } = ctx;
  if (!store) {
    return `🧠 Memory: UNAVAILABLE — ${ctx.storeError || 'the memory database could not be opened'}.\nI can still chat, but I will not remember this conversation.`;
  }
  switch (ctx.cmd) {
    case 'status': return status(ctx, now);
    case 'recent': {
      const mems = store.recentMemories(owner, { limit: 10 });
      const convos = store.listConversations(owner, { limit: 5 });
      return [
        `🧠 Recent memories (${mems.length}):`,
        ...(mems.length ? mems.map(fmtMemory) : ['none yet — say "remember that …" to save one']),
        '',
        `💬 Recent conversations (${convos.length}):`,
        ...convos.map((c) => `${c.id.slice(0, 8)} · ${c.message_count} msgs · ${since(c.updated_at, now)} · ${c.title || '(untitled)'}`),
      ].join('\n');
    }
    case 'search': {
      if (!ctx.arg) return 'Usage: memory search <words>';
      const mems = store.searchMemories(owner, ctx.arg, { limit: 10 });
      const msgs = store.searchMessages(owner, ctx.arg, { limit: 5 });
      return [
        `🔎 Memories matching "${ctx.arg}" (${mems.length}):`,
        ...(mems.length ? mems.map(fmtMemory) : ['none']),
        '',
        `💬 Earlier messages (${msgs.length}):`,
        ...(msgs.length ? msgs.map((m) => `${String(m.created_at).slice(0, 10)} · chat ${m.conversation_id.slice(0, 8)}: ${m.content.slice(0, 160)}`) : ['none']),
      ].join('\n');
    }
    case 'forget': {
      if (!ctx.arg) return 'Usage: memory forget <id or exact words>';
      const n = store.forget(owner, ctx.arg);
      return n ? `🗑️ Forgot ${n} memor${n === 1 ? 'y' : 'ies'} (including older versions).` : `Nothing matched "${ctx.arg}". Use "memory search" to find the id.`;
    }
    case 'project': {
      const [name, action] = ctx.arg.toLowerCase().split(/\s+/);
      if (!PROJECTS.includes(name)) return `Usage: memory project <${PROJECTS.join('|')}> [refresh]`;
      let refreshNote = '';
      if (action === 'refresh' || needsRefresh(store, name, now)) {
        const r = await refreshProject(store, name, { root: ctx.root, git: ctx.git, diagnostics: ctx.diagnostics });
        refreshNote = r.errors.length ? `\n(refresh: ${r.recorded} recorded; unavailable: ${r.errors.join('; ')})` : '';
      }
      const memories = store.searchMemories(owner, name, { limit: 5 });
      return describeProject(store, name, { now, memories }) + refreshNote;
    }
    case 'audit': return audit(store, now);
    default: return 'Unknown memory command.';
  }
}

function status(ctx, now) {
  const { store, owner } = ctx;
  const lines = ['🧠 Memory status'];
  const degraded = [];
  let counts = null;
  try {
    counts = store.counts(owner);
    lines.push(`• Database: connected (schema v${store.schemaVersion()})`);
  } catch (e) {
    lines.push(`• Database: ERROR — ${e.message}`);
    degraded.push('database');
  }
  let writable = false;
  try { writable = store.probeWrite(); } catch (e) { degraded.push(`writes (${e.message})`); }
  lines.push(`• Conversation persistence: ${writable ? 'OK' : 'FAILING'}${counts ? ` — ${counts.conversations} conversations, ${counts.messages} messages` : ''}`);
  lines.push(`• Memory writes: ${writable ? 'OK' : 'FAILING'} — last write ${since(store.getMeta('last_memory_write'), now)}${counts ? `; ${counts.memories} active, ${counts.superseded} superseded` : ''}`);
  lines.push(`• Memory retrieval: last successful ${since(store.getMeta('last_memory_retrieval'), now)}`);
  lines.push(`• This conversation: ${ctx.conversationId || 'none (a new one starts with your next message)'}`);
  const t = ctx.lastTurn;
  if (t) {
    lines.push(`• Last turn used: ${t.historyMessages} earlier messages from this chat, memories ${t.memoryIds.length ? t.memoryIds.map((i) => `#${i}`).join(', ') : 'none'}, ${t.relatedMessageIds.length} related messages from other chats`);
    if (t.degraded && t.degraded.length) degraded.push(...t.degraded);
  } else {
    lines.push('• Last turn used: no turn recorded since Heidi started');
  }
  const fresh = PROJECTS.map((p) => `${p} ${since(store.getMeta(`project_refresh_${p}`), now)}`).join(', ');
  lines.push(`• Project state refreshed: ${fresh}`);
  lines.push(degraded.length ? `⚠️ Degraded: ${degraded.join('; ')}` : '✅ No degraded dependencies');
  return lines.join('\n');
}

/** Safe, repeatable self-test on throwaway owners; cleans up after itself. */
function audit(store, now) {
  const tag = crypto.randomBytes(4).toString('hex');
  const owner = `__audit__${tag}`;
  const other = `__audit_other__${tag}`;
  const results = [];
  const check = (name, fn) => {
    try { results.push([name, fn() ? 'PASS' : 'FAIL']); } catch (e) { results.push([name, `FAIL (${e.message})`]); }
  };
  let convo = null;
  try {
    check('create conversation', () => { convo = store.createConversation(owner, 'audit'); return Boolean(convo); });
    check('save + reload message', () => {
      store.appendMessage(owner, convo.id, 'user', `audit message ${tag}`, { requestId: `r-${tag}` });
      store.appendMessage(owner, convo.id, 'user', `audit message ${tag}`, { requestId: `r-${tag}` });
      const msgs = store.listMessages(owner, convo.id);
      return msgs.length === 1 && msgs[0].content.includes(tag);
    });
    check('save + retrieve memory', () => {
      store.saveMemory(owner, { category: 'fact', key: `audit color ${tag}`, content: `audit color ${tag} is teal` });
      return store.searchMemories(owner, `audit color ${tag}`).some((m) => m.content.includes('teal'));
    });
    check('update supersedes old value', () => {
      const r = store.saveMemory(owner, { category: 'fact', key: `audit color ${tag}`, content: `audit color ${tag} is amber` });
      const hits = store.searchMemories(owner, `audit color ${tag}`);
      return r.action === 'superseded' && hits.length === 1 && hits[0].content.includes('amber');
    });
    check('other owner cannot read', () => store.searchMemories(other, `audit color ${tag}`).length === 0
      && store.getConversation(other, convo.id) === null);
    check('credentials refused', () => store.saveMemory(owner, { category: 'fact', content: `the api key is ${'sk_' + 'live_'}${tag}abcdefgh` }).action === 'refused');
    check('forget removes all versions', () => store.forget(owner, `audit color ${tag}`) === 2 && store.searchMemories(owner, `audit color ${tag}`).length === 0);
  } finally {
    try { if (convo) store.deleteConversation(owner, convo.id); } catch { /* reported below */ }
    try { store.forget(owner, `audit color ${tag}`); } catch { /* nothing left */ }
  }
  const passed = results.filter((r) => r[1] === 'PASS').length;
  return [`🧪 Memory audit ${passed}/${results.length} passed (${new Date(now).toISOString()})`, ...results.map(([n, r]) => `${r === 'PASS' ? '✅' : '❌'} ${n}: ${r}`)].join('\n');
}

module.exports = { parseMemoryCommand, runMemoryCommand };
