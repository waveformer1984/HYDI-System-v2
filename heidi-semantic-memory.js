/**
 * Heidi Semantic Memory
 * Stores key facts from conversations and recalls relevant ones via cosine similarity.
 * Uses Ollama /api/embeddings for vectors; persists to Supabase or local JSON fallback.
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

// ── Storage (local JSON — Supabase path kept for later) ───────────────────────

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
 * @param {string} content   — the fact/summary to remember
 * @param {string} ollamaUrl — e.g. http://localhost:11434
 * @param {object} [meta]    — optional: { source, importance }
 */
async function store(deviceId, content, ollamaUrl, meta = {}) {
    if (!content || !content.trim()) return false;
    const embedding = await embed(content.slice(0, 512), ollamaUrl);
    if (!embedding) return false;   // no embedding model available

    const db = loadStore();
    if (!db[deviceId]) db[deviceId] = [];

    // Deduplicate: skip if very similar to an existing memory
    for (const m of db[deviceId]) {
        if (m.embedding && cosine(embedding, m.embedding) > 0.95) return false;
    }

    db[deviceId].push({
        id:        `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        content:   content.slice(0, 512),
        embedding,
        source:    meta.source || 'chat',
        importance: meta.importance || 0.5,
        ts:        Date.now()
    });

    // Keep most recent MAX_MEMORIES per device
    if (db[deviceId].length > MAX_MEMORIES) {
        db[deviceId] = db[deviceId].slice(-MAX_MEMORIES);
    }

    saveStore(db);
    return true;
}

/**
 * Recall the top-K memories most relevant to a query.
 * @returns {string[]} — array of memory content strings
 */
async function recall(deviceId, query, ollamaUrl, topK = RECALL_TOP_K) {
    const db = loadStore();
    const memories = db[deviceId];
    if (!memories || memories.length === 0) return [];

    const qEmbedding = await embed(query.slice(0, 256), ollamaUrl);
    if (!qEmbedding) return [];

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
 */
async function extractAndStore(deviceId, userMsg, assistantReply, ollamaUrl, model) {
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
            await store(deviceId, fact, ollamaUrl, { source: 'extract', importance: 0.7 });
        }
    } catch {}
}

/**
 * List all memories for a device (for debugging / review).
 */
function listMemories(deviceId) {
    const db = loadStore();
    return (db[deviceId] || []).map(m => ({ id: m.id, content: m.content, ts: new Date(m.ts).toISOString() }));
}

/**
 * Delete all memories for a device.
 */
function clearMemories(deviceId) {
    const db = loadStore();
    delete db[deviceId];
    saveStore(db);
}

module.exports = { store, recall, extractAndStore, listMemories, clearMemories };
