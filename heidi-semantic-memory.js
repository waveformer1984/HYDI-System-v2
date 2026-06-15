/**
 * Heidi Semantic Memory
 * Stores key facts from conversations and recalls relevant ones via cosine similarity.
 * Uses Ollama /api/embeddings for vectors; persists to Supabase (primary) with local JSON fallback.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MEMORY_FILE   = path.join(__dirname, '.heidi-memory.json');
const MAX_MEMORIES  = 500;   // per device
const RECALL_TOP_K  = 5;
const MIN_SIM       = 0.72;  // cosine similarity threshold

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Storage (local JSON) ──────────────────────────────────────────────────────

function loadStore() {
    try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
    catch { return {}; }
}

function saveStore(store) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store), 'utf8');
}

// ── Embedding via Ollama ──────────────────────────────────────────────────────

async function embed(text, ollamaUrl, model = 'nomic-embed-text') {
    const primary = [model, 'mxbai-embed-large', 'tinyllama'];
    for (const m of primary) {
        try {
            const r = await fetch(`${ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: m, prompt: text }),
                signal: AbortSignal.timeout(8000)
            });
            if (!r.ok) continue;
            const { embedding } = await r.json();
            if (Array.isArray(embedding) && embedding.length > 0) return embedding;
        } catch {}
    }
    return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Store a memory for a device.
 * @param {string} deviceId
 * @param {string} content    — the fact/summary to remember
 * @param {string} ollamaUrl  — e.g. http://localhost:11434
 * @param {object} [meta]     — optional: { source, importance }
 * @param {object} [supabase] — optional Supabase client; falls back to local JSON when null
 */
async function store(deviceId, content, ollamaUrl, meta = {}, supabase = null) {
    if (!content || !content.trim()) return false;
    const embedding = await embed(content.slice(0, 512), ollamaUrl);
    if (!embedding) return false;   // no embedding model available

    const db = loadStore();
    if (!db[deviceId]) db[deviceId] = [];

    // Deduplicate: skip if very similar to an existing memory
    for (const m of db[deviceId]) {
        if (m.embedding && cosine(embedding, m.embedding) > 0.95) return false;
    }

    const id        = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const source    = meta.source     || 'chat';
    const importance = meta.importance !== undefined ? meta.importance : 0.5;

    db[deviceId].push({
        id,
        content:   content.slice(0, 512),
        embedding,
        source,
        importance,
        ts:        Date.now()
    });

    // Keep most recent MAX_MEMORIES per device
    if (db[deviceId].length > MAX_MEMORIES) {
        db[deviceId] = db[deviceId].slice(-MAX_MEMORIES);
    }

    // Dual-write: local JSON is always the cache
    saveStore(db);

    // Supabase upsert (best-effort — never blocks the local write)
    if (supabase) {
        try {
            await supabase.from('heidi_memories').upsert({
                id,
                device_id:  deviceId,
                content:    content.slice(0, 512),
                embedding:  JSON.stringify(embedding),
                source,
                importance
            }, { onConflict: 'id' });
        } catch {}
    }

    return true;
}

/**
 * Recall the top-K memories most relevant to a query.
 * Tries Supabase first; falls back to local JSON store if Supabase is unavailable or returns nothing.
 * @param {string} deviceId
 * @param {string} query
 * @param {string} ollamaUrl
 * @param {number} [topK]
 * @param {object} [supabase] — optional Supabase client
 * @returns {string[]} — array of memory content strings
 */
async function recall(deviceId, query, ollamaUrl, topK = RECALL_TOP_K, supabase = null) {
    const qEmbedding = await embed(query.slice(0, 256), ollamaUrl);
    if (!qEmbedding) return [];

    // Try Supabase first
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('heidi_memories')
                .select('content, embedding')
                .eq('device_id', deviceId);

            if (!error && data && data.length > 0) {
                const scored = data
                    .filter(row => row.embedding)
                    .map(row => {
                        let emb;
                        try { emb = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding; }
                        catch { return null; }
                        if (!Array.isArray(emb)) return null;
                        return { content: row.content, sim: cosine(qEmbedding, emb) };
                    })
                    .filter(m => m !== null && m.sim >= MIN_SIM)
                    .sort((a, b) => b.sim - a.sim)
                    .slice(0, topK);

                if (scored.length > 0) return scored.map(m => m.content);
            }
        } catch {}
    }

    // Fall back to local JSON store
    const db = loadStore();
    const memories = db[deviceId];
    if (!memories || memories.length === 0) return [];

    const scored = memories
        .filter(m => m.embedding)
        .map(m => ({ content: m.content, sim: cosine(qEmbedding, m.embedding) }))
        .filter(m => m.sim >= MIN_SIM)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, topK);

    return scored.map(m => m.content);
}

/**
 * Extract and store memory fragments from an assistant reply.
 * Asks Ollama to pull facts worth remembering.
 * @param {string} deviceId
 * @param {string} userMsg
 * @param {string} assistantReply
 * @param {string} ollamaUrl
 * @param {string} model
 * @param {object} [supabase] — optional Supabase client
 */
async function extractAndStore(deviceId, userMsg, assistantReply, ollamaUrl, model, supabase = null) {
    if (!assistantReply || assistantReply.length < 60) return;
    const prompt = `From this exchange, extract 1-3 brief facts worth remembering long-term (operator preferences, decisions made, key figures, system state). If nothing notable, reply NONE.

User: ${userMsg.slice(0, 200)}
Assistant: ${assistantReply.slice(0, 400)}

Facts (one per line, or NONE):`;

    try {
        const r = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.2, num_predict: 120 } }),
            signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) return;
        const text = ((await r.json()).response || '').trim();
        if (!text || text.toUpperCase().startsWith('NONE')) return;

        const facts = text.split('\n').map(l => l.replace(/^[-*•\d.]+\s*/, '').trim()).filter(l => l.length > 15);
        for (const fact of facts.slice(0, 3)) {
            await store(deviceId, fact, ollamaUrl, { source: 'extract', importance: 0.7 }, supabase);
        }
    } catch {}
}

/**
 * List all memories for a device (for debugging / review).
 * When supabase is provided, reads from Supabase; also always reads local JSON.
 * Returns merged results (Supabase preferred when available).
 * @param {string} deviceId
 * @param {object} [supabase] — optional Supabase client
 */
async function listMemories(deviceId, supabase = null) {
    // Always include local JSON entries as baseline
    const db = loadStore();
    const localEntries = (db[deviceId] || []).map(m => ({
        id:      m.id,
        content: m.content,
        ts:      new Date(m.ts).toISOString()
    }));

    if (!supabase) return localEntries;

    try {
        const { data, error } = await supabase
            .from('heidi_memories')
            .select('id, content, created_at')
            .eq('device_id', deviceId)
            .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
            return data.map(row => ({
                id:      row.id,
                content: row.content,
                ts:      row.created_at
            }));
        }
    } catch {}

    return localEntries;
}

/**
 * Delete all memories for a device.
 * When supabase is provided, deletes from both Supabase and local JSON.
 * @param {string} deviceId
 * @param {object} [supabase] — optional Supabase client
 */
async function clearMemories(deviceId, supabase = null) {
    // Always clear local JSON
    const db = loadStore();
    delete db[deviceId];
    saveStore(db);

    if (supabase) {
        try {
            await supabase
                .from('heidi_memories')
                .delete()
                .eq('device_id', deviceId);
        } catch {}
    }
}

module.exports = { store, recall, extractAndStore, listMemories, clearMemories };
