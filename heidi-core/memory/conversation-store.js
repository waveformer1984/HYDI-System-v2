'use strict';

/**
 * Heidi's persistent conversations, long-term memory and project state.
 *
 * Why this exists (2026-10-28 root cause): the mobile chat path
 * (launch-heidi-mobile.js -> heidi-core /chat-tools) sent each message on its
 * own, with no conversation id and no history, and /chat-tools built its
 * prompt from [system, this message] only. Nothing earlier in the
 * conversation, and no stored fact, ever reached the model. The legacy
 * `short_term` table also had no notion of a conversation or an owner, and
 * when the native `sqlite3` module failed to load, heidi-core silently fell
 * back to an in-memory store that forgot everything on restart.
 *
 * This store lives in the same SQLite file as the legacy tables
 * (heidi-core/data/heidi_memory.db) but uses Node's built-in `node:sqlite`
 * (Node >= 22.13, no native build step), so it cannot silently fall back to
 * RAM: if the database can't be opened, construction throws and callers
 * report a degraded state instead.
 *
 * Every read and write is scoped by `owner`. Callers resolve the owner from
 * the authenticated request; a caller can never read another owner's rows.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { containsSecret } = require('./secret-filter');

const CATEGORIES = Object.freeze([
  'preference', // user preferences
  'fact', // stable facts the user stated
  'architecture', // project architecture
  'decision', // decisions and their rationale
  'task', // open tasks and blockers
  'completed', // completed work and verified outcomes
  'observation', // operational observations
  'lesson', // lessons learned
]);
const VERIFICATION = Object.freeze(['user_stated', 'observed', 'verified', 'inferred']);
const PROJECT_KINDS = Object.freeze(['user_reported', 'documentation', 'repo_verified', 'live_verified']);
const MAX_CONTENT = 2000;
const STOPWORDS = new Set(('a an and are as at be but by can could did do does for from had has have how i if in into is it its me '
  + 'my no not of on or our please so that the their them then there these they this to was we were what when '
  + 'where which who why will with would you your heidi tell about know remember').split(' '));

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS hm_conversations (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hm_conversations_owner ON hm_conversations(owner, updated_at);

      CREATE TABLE IF NOT EXISTS hm_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES hm_conversations(id) ON DELETE CASCADE,
        owner TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        request_id TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        created_at TEXT NOT NULL,
        UNIQUE (conversation_id, request_id, role)
      );
      CREATE INDEX IF NOT EXISTS hm_messages_conv ON hm_messages(conversation_id, id);

      CREATE VIRTUAL TABLE IF NOT EXISTS hm_messages_fts USING fts5(content, content='hm_messages', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS hm_messages_ai AFTER INSERT ON hm_messages BEGIN
        INSERT INTO hm_messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS hm_messages_ad AFTER DELETE ON hm_messages BEGIN
        INSERT INTO hm_messages_fts(hm_messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;

      CREATE TABLE IF NOT EXISTS hm_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        category TEXT NOT NULL,
        mkey TEXT,
        content TEXT NOT NULL,
        source_conversation_id TEXT,
        source_message_id INTEGER,
        verification TEXT NOT NULL DEFAULT 'user_stated',
        confidence REAL NOT NULL DEFAULT 0.8,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT,
        expires_at TEXT,
        superseded_by INTEGER,
        conflict_with INTEGER,
        related TEXT
      );
      CREATE INDEX IF NOT EXISTS hm_memories_owner ON hm_memories(owner, category, mkey);

      CREATE VIRTUAL TABLE IF NOT EXISTS hm_memories_fts USING fts5(content, mkey, content='hm_memories', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS hm_memories_ai AFTER INSERT ON hm_memories BEGIN
        INSERT INTO hm_memories_fts(rowid, content, mkey) VALUES (new.id, new.content, new.mkey);
      END;
      CREATE TRIGGER IF NOT EXISTS hm_memories_ad AFTER DELETE ON hm_memories BEGIN
        INSERT INTO hm_memories_fts(hm_memories_fts, rowid, content, mkey) VALUES ('delete', old.id, old.content, old.mkey);
      END;
      CREATE TRIGGER IF NOT EXISTS hm_memories_au AFTER UPDATE OF content, mkey ON hm_memories BEGIN
        INSERT INTO hm_memories_fts(hm_memories_fts, rowid, content, mkey) VALUES ('delete', old.id, old.content, old.mkey);
        INSERT INTO hm_memories_fts(rowid, content, mkey) VALUES (new.id, new.content, new.mkey);
      END;

      CREATE TABLE IF NOT EXISTS hm_project_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        skey TEXT NOT NULL,
        value TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hm_project_state_key ON hm_project_state(project, skey, id);

      CREATE TABLE IF NOT EXISTS hm_meta (k TEXT PRIMARY KEY, v TEXT);
    `,
  },
];

function normalizeKey(key) {
  const k = String(key || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return k ? k.slice(0, 80) : null;
}

/** FTS5 MATCH expression from free text: quoted significant words OR'ed. Null when nothing is searchable. */
function ftsQuery(text) {
  const words = (String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .filter((w) => !STOPWORDS.has(w));
  const unique = [...new Set(words)].slice(0, 12);
  return unique.length ? unique.map((w) => `"${w}"`).join(' OR ') : null;
}

class ConversationStore {
  /**
   * @param {{ dbPath?: string, now?: () => Date }} [opts]
   * Throws when the database can't be opened: there is no in-memory fallback.
   */
  constructor(opts = {}) {
    this.dbPath = opts.dbPath || path.join(__dirname, '../data/heidi_memory.db');
    this.now = opts.now || (() => new Date());
    if (this.dbPath !== ':memory:') fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS hm_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.db.prepare('SELECT version FROM hm_schema_migrations').all().map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(m.sql);
        this.db.prepare('INSERT INTO hm_schema_migrations(version, applied_at) VALUES (?, ?)').run(m.version, this.iso());
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  schemaVersion() {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM hm_schema_migrations').get();
    return row ? row.v : 0;
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }

  iso() { return this.now().toISOString(); }

  setMeta(k, v) {
    this.db.prepare('INSERT INTO hm_meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
  }

  getMeta(k) {
    const row = this.db.prepare('SELECT v FROM hm_meta WHERE k = ?').get(k);
    return row ? row.v : null;
  }

  // ── Conversations ───────────────────────────────────────────────────────

  createConversation(owner, title = null) {
    if (!owner) throw new Error('owner required');
    const id = crypto.randomUUID();
    const at = this.iso();
    this.db.prepare('INSERT INTO hm_conversations(id, owner, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, owner, title ? String(title).slice(0, 120) : null, at, at);
    return this.getConversation(owner, id);
  }

  /** The owner's conversation, or null (also null for another owner's id). */
  getConversation(owner, id) {
    if (!owner || !id) return null;
    return this.db.prepare('SELECT id, title, created_at, updated_at FROM hm_conversations WHERE id = ? AND owner = ?')
      .get(String(id), owner) || null;
  }

  listConversations(owner, { limit = 20 } = {}) {
    return this.db.prepare(`
      SELECT c.id, c.title, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM hm_messages m WHERE m.conversation_id = c.id) AS message_count
      FROM hm_conversations c WHERE c.owner = ? ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`)
      .all(owner, Math.max(1, Math.min(100, limit)));
  }

  /**
   * Appends a message. With a requestId, a retry of the same request returns
   * the row already stored instead of adding a duplicate.
   */
  appendMessage(owner, conversationId, role, content, { requestId = null, status = 'ok' } = {}) {
    const convo = this.getConversation(owner, conversationId);
    if (!convo) throw new Error('conversation not found');
    const text = String(content == null ? '' : content);
    const at = this.iso();
    if (requestId) {
      const existing = this.db.prepare('SELECT * FROM hm_messages WHERE conversation_id = ? AND request_id = ? AND role = ?')
        .get(conversationId, String(requestId), role);
      if (existing) return { ...existing, duplicate: true };
    }
    const r = this.db.prepare(`INSERT INTO hm_messages(conversation_id, owner, role, content, request_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(conversationId, owner, role, text, requestId ? String(requestId) : null, status, at);
    const title = convo.title || (role === 'user' ? text.replace(/\s+/g, ' ').slice(0, 60) : null);
    this.db.prepare('UPDATE hm_conversations SET updated_at = ?, title = ? WHERE id = ?').run(at, title, conversationId);
    this.setMeta('last_message_write', at);
    return this.db.prepare('SELECT * FROM hm_messages WHERE id = ?').get(Number(r.lastInsertRowid));
  }

  /** Deletes the owner's conversation and its messages. Returns true when something was deleted. */
  deleteConversation(owner, id) {
    if (!this.getConversation(owner, id)) return false;
    this.db.prepare('DELETE FROM hm_messages WHERE conversation_id = ? AND owner = ?').run(String(id), owner);
    this.db.prepare('DELETE FROM hm_conversations WHERE id = ? AND owner = ?').run(String(id), owner);
    return true;
  }

  /** Proves the database accepts writes without keeping anything. */
  probeWrite() {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO hm_meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run('__probe__', this.iso());
    } finally {
      this.db.exec('ROLLBACK');
    }
    return true;
  }

  /** Messages oldest-first. `before` pages backwards by message id. */
  listMessages(owner, conversationId, { limit = 50, before = null } = {}) {
    if (!this.getConversation(owner, conversationId)) throw new Error('conversation not found');
    const lim = Math.max(1, Math.min(200, limit));
    const rows = before
      ? this.db.prepare('SELECT id, role, content, status, created_at FROM hm_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
        .all(conversationId, Number(before), lim)
      : this.db.prepare('SELECT id, role, content, status, created_at FROM hm_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
        .all(conversationId, lim);
    return rows.reverse();
  }

  /** The most recent messages that fit in `charBudget`, oldest-first. */
  recentMessages(owner, conversationId, { charBudget = 3500, maxMessages = 20 } = {}) {
    const rows = this.listMessages(owner, conversationId, { limit: maxMessages }).reverse();
    const out = [];
    let used = 0;
    for (const m of rows) {
      if (m.status !== 'ok') continue;
      const len = m.content.length;
      if (used + len > charBudget) {
        if (!out.length) out.push({ ...m, content: `${m.content.slice(0, charBudget - 1)}…` });
        break;
      }
      out.push(m);
      used += len;
    }
    return out.reverse();
  }

  /** Older messages from the owner's other conversations that match `query`. */
  searchMessages(owner, query, { excludeConversationId = null, limit = 3 } = {}) {
    const q = ftsQuery(query);
    if (!q) return [];
    return this.db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
      FROM hm_messages_fts f JOIN hm_messages m ON m.id = f.rowid
      WHERE hm_messages_fts MATCH ? AND m.owner = ? AND m.conversation_id IS NOT ? AND m.role = 'user'
      ORDER BY bm25(hm_messages_fts) LIMIT ?`).all(q, owner, excludeConversationId, Math.max(1, Math.min(20, limit)));
  }

  /** Which of these message ids a memory (current or superseded) was taken from. */
  memorySourceIds(owner, messageIds) {
    const ids = (messageIds || []).map(Number).filter(Number.isFinite);
    if (!ids.length) return new Set();
    return new Set(this.db.prepare(`SELECT source_message_id AS id FROM hm_memories WHERE owner = ?
      AND source_message_id IN (${ids.map(() => '?').join(',')})`).all(owner, ...ids).map((r) => r.id));
  }

  // ── Long-term memory ────────────────────────────────────────────────────

  /**
   * Saves a memory. Same owner + category + key:
   *   - same content  -> refreshes the existing memory (no duplicate);
   *   - new content   -> a new memory that supersedes the old one, and the old
   *                      one records the conflict.
   * Returns { memory, action: 'created'|'refreshed'|'superseded'|'refused', reason? }.
   */
  saveMemory(owner, input) {
    if (!owner) throw new Error('owner required');
    const category = String(input.category || '');
    if (!CATEGORIES.includes(category)) return { action: 'refused', reason: `unknown category ${category}` };
    const content = String(input.content || '').replace(/\s+/g, ' ').trim();
    if (!content) return { action: 'refused', reason: 'empty' };
    if (content.length > MAX_CONTENT) return { action: 'refused', reason: 'too long' };
    if (containsSecret(content) || containsSecret(input.key)) return { action: 'refused', reason: 'looks like a credential' };
    const verification = VERIFICATION.includes(input.verification) ? input.verification : 'user_stated';
    const mkey = normalizeKey(input.key);
    const at = this.iso();
    const num = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);

    const existing = mkey ? this.db.prepare(`SELECT * FROM hm_memories WHERE owner = ? AND category = ? AND mkey = ?
      AND superseded_by IS NULL ORDER BY id DESC LIMIT 1`).get(owner, category, mkey) : null;
    const exact = !existing ? this.db.prepare(`SELECT * FROM hm_memories WHERE owner = ? AND category = ? AND lower(content) = lower(?)
      AND superseded_by IS NULL LIMIT 1`).get(owner, category, content) : null;
    const same = existing && existing.content.toLowerCase() === content.toLowerCase() ? existing : exact;

    if (same) {
      this.db.prepare('UPDATE hm_memories SET updated_at = ?, last_verified_at = ?, importance = MAX(importance, ?) WHERE id = ?')
        .run(at, at, num(input.importance, same.importance), same.id);
      this.setMeta('last_memory_write', at);
      return { action: 'refreshed', memory: this.getMemory(owner, same.id) };
    }

    const r = this.db.prepare(`INSERT INTO hm_memories(owner, category, mkey, content, source_conversation_id, source_message_id,
        verification, confidence, importance, created_at, updated_at, last_verified_at, expires_at, related)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      owner, category, mkey, content,
      input.sourceConversationId || null, input.sourceMessageId || null,
      verification, num(input.confidence, 0.8), num(input.importance, 0.5),
      at, at, at, input.expiresAt || null, input.related ? JSON.stringify(input.related) : null,
    );
    const id = Number(r.lastInsertRowid);
    let action = 'created';
    if (existing) {
      this.db.prepare('UPDATE hm_memories SET superseded_by = ?, conflict_with = ?, updated_at = ? WHERE id = ?').run(id, id, at, existing.id);
      action = 'superseded';
    }
    this.setMeta('last_memory_write', at);
    return { action, memory: this.getMemory(owner, id), replaced: existing ? this.getMemory(owner, existing.id) : null };
  }

  getMemory(owner, id) {
    return this.db.prepare('SELECT * FROM hm_memories WHERE id = ? AND owner = ?').get(Number(id), owner) || null;
  }

  activeClause() {
    return `m.superseded_by IS NULL AND (m.expires_at IS NULL OR m.expires_at > '${this.iso()}')`;
  }

  /** Active memories ranked by text relevance, then importance and recency. */
  searchMemories(owner, query, { limit = 6, categories = null } = {}) {
    const q = ftsQuery(query);
    if (!q) return [];
    const cats = Array.isArray(categories) && categories.length ? categories.filter((c) => CATEGORIES.includes(c)) : null;
    const rows = this.db.prepare(`
      SELECT m.*, bm25(hm_memories_fts) AS rank
      FROM hm_memories_fts f JOIN hm_memories m ON m.id = f.rowid
      WHERE hm_memories_fts MATCH ? AND m.owner = ? AND ${this.activeClause()}
      ${cats ? `AND m.category IN (${cats.map(() => '?').join(',')})` : ''}
      ORDER BY bm25(hm_memories_fts) - (m.importance * 2) ASC, m.updated_at DESC LIMIT ?`)
      .all(q, owner, ...(cats || []), Math.max(1, Math.min(50, limit)));
    if (rows.length) this.setMeta('last_memory_retrieval', this.iso());
    return rows;
  }

  recentMemories(owner, { limit = 10, includeSuperseded = false } = {}) {
    return this.db.prepare(`SELECT m.* FROM hm_memories m WHERE m.owner = ? ${includeSuperseded ? '' : `AND ${this.activeClause()}`}
      ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`).all(owner, Math.max(1, Math.min(100, limit)));
  }

  /** Most important active memories regardless of the question (preferences first). */
  standingMemories(owner, { limit = 4 } = {}) {
    return this.db.prepare(`SELECT m.* FROM hm_memories m WHERE m.owner = ? AND ${this.activeClause()}
      AND (m.category = 'preference' OR m.importance >= 0.8)
      ORDER BY (m.category = 'preference') DESC, m.importance DESC, m.updated_at DESC LIMIT ?`).all(owner, limit);
  }

  /**
   * Deletes a memory (and its superseded history) by id, or the active
   * memories whose content matches `text`. Returns how many rows were removed.
   */
  forget(owner, idOrText) {
    const raw = String(idOrText || '').trim().replace(/^#/, '');
    if (!raw) return 0;
    let ids;
    if (/^\d+$/.test(raw)) {
      ids = this.getMemory(owner, raw) ? [Number(raw)] : [];
    } else {
      const q = ftsQuery(raw);
      if (!q) return 0;
      ids = this.db.prepare(`SELECT m.id FROM hm_memories_fts f JOIN hm_memories m ON m.id = f.rowid
        WHERE hm_memories_fts MATCH ? AND m.owner = ? AND m.superseded_by IS NULL`).all(q, owner)
        .map((r) => r.id)
        .filter((id) => {
          const m = this.getMemory(owner, id);
          return m && m.content.toLowerCase().includes(raw.toLowerCase());
        });
    }
    let removed = 0;
    for (const id of ids) {
      // Remove the memory and every older version it superseded.
      const chain = [id];
      for (let i = 0; i < chain.length; i += 1) {
        for (const r of this.db.prepare('SELECT id FROM hm_memories WHERE owner = ? AND superseded_by = ?').all(owner, chain[i])) chain.push(r.id);
      }
      for (const cid of chain) removed += Number(this.db.prepare('DELETE FROM hm_memories WHERE id = ? AND owner = ?').run(cid, owner).changes);
    }
    return removed;
  }

  counts(owner) {
    const one = (sql, ...a) => this.db.prepare(sql).get(...a).n;
    return {
      conversations: one('SELECT COUNT(*) n FROM hm_conversations WHERE owner = ?', owner),
      messages: one('SELECT COUNT(*) n FROM hm_messages WHERE owner = ?', owner),
      memories: one(`SELECT COUNT(*) n FROM hm_memories m WHERE m.owner = ? AND ${this.activeClause()}`, owner),
      superseded: one('SELECT COUNT(*) n FROM hm_memories WHERE owner = ? AND superseded_by IS NOT NULL', owner),
    };
  }

  // ── Project state ───────────────────────────────────────────────────────

  recordProjectState(project, key, value, { kind, source, observedAt = null }) {
    if (!PROJECT_KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
    if (!source) throw new Error('source required');
    const text = String(value == null ? '' : value).slice(0, 500);
    if (containsSecret(text)) throw new Error('refusing to store a credential-like value');
    const at = this.iso();
    this.db.prepare(`INSERT INTO hm_project_state(project, skey, value, kind, source, observed_at, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(String(project).toLowerCase(), String(key), text, kind, String(source), observedAt || at, at);
  }

  /** Latest observation per key for a project. */
  projectState(project) {
    return this.db.prepare(`SELECT p.* FROM hm_project_state p
      WHERE p.project = ? AND p.id = (SELECT MAX(q.id) FROM hm_project_state q WHERE q.project = p.project AND q.skey = p.skey)
      ORDER BY p.skey`).all(String(project).toLowerCase());
  }
}

module.exports = { ConversationStore, CATEGORIES, VERIFICATION, PROJECT_KINDS, normalizeKey, ftsQuery };
