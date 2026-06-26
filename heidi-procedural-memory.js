/**
 * Heidi Procedural Memory
 * Stores lessons learned from action execution and recalls relevant ones via cosine similarity.
 * Uses Ollama /api/embeddings for vectors; persists to Supabase (primary) with local JSON fallback.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PROCEDURAL_FILE = path.join(__dirname, '.heidi-procedural-memory.json');
const MAX_LESSONS    = 200;   // per device
const RECALL_TOP_K   = 3;
const MIN_SIM        = 0.75;  // cosine similarity threshold

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Storage (local JSON) ──────────────────────────────────────────────────────

function loadStore() {
    try { return JSON.parse(fs.readFileSync(PROCEDURAL_FILE, 'utf8')); }
    catch { return {}; }
}

function saveStore(store) {
    fs.writeFileSync(PROCEDURAL_FILE, JSON.stringify(store), 'utf8');
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
 * Store a procedural lesson for a device.
 * @param {string} deviceId
 * @param {object} lessonData — { situation, action_type, action_summary, outcome, outcome_detail, lesson, confidence }
 * @param {string} ollamaUrl  — e.g. http://localhost:11434
 * @param {object} [supabase] — optional Supabase client; falls back to local JSON when null
 */
async function storeLesson(deviceId, lessonData, ollamaUrl, supabase = null) {
    const { situation, action_type, action_summary, outcome, outcome_detail, lesson, confidence = 0.5 } = lessonData;
    
    if (!situation || !lesson) return false;
    
    // Embed situation and lesson
    const situationEmbed = await embed(situation.slice(0, 512), ollamaUrl);
    const lessonEmbed = await embed(lesson.slice(0, 512), ollamaUrl);
    if (!situationEmbed || !lessonEmbed) return false;

    const db = loadStore();
    if (!db[deviceId]) db[deviceId] = { lessons: [] };

    // Deduplicate: skip if very similar to an existing lesson
    for (const l of db[deviceId].lessons) {
        if (l.situation_emb && cosine(situationEmbed, l.situation_emb) > 0.95) return false;
    }

    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const lessonRecord = {
        id,
        device_id: deviceId,
        situation: situation.slice(0, 512),
        situation_emb: situationEmbed,
        action_type,
        action_summary: action_summary?.slice(0, 256) || '',
        outcome,
        outcome_detail: outcome_detail?.slice(0, 256) || '',
        lesson: lesson.slice(0, 512),
        lesson_emb: lessonEmbed,
        confidence,
        application_count: 0,
        success_count: 0,
        last_applied_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    db[deviceId].lessons.push(lessonRecord);

    // Keep most recent MAX_LESSONS per device
    if (db[deviceId].lessons.length > MAX_LESSONS) {
        db[deviceId].lessons = db[deviceId].lessons.slice(-MAX_LESSONS);
    }

    // Dual-write: local JSON is always the cache
    saveStore(db);

    // Supabase upsert (best-effort — never blocks the local write)
    if (supabase) {
        try {
            await supabase.from('heidi_procedural_lessons').upsert({
                id,
                device_id: deviceId,
                situation: lessonRecord.situation,
                situation_emb: JSON.stringify(situationEmbed),
                action_type,
                action_summary: lessonRecord.action_summary,
                outcome,
                outcome_detail: lessonRecord.outcome_detail,
                lesson: lessonRecord.lesson,
                lesson_emb: JSON.stringify(lessonEmbed),
                confidence,
                application_count: 0,
                success_count: 0
            }, { onConflict: 'id' });
        } catch (e) {
            console.log('[ProceduralMemory] Supabase upsert failed:', e.message);
        }
    }

    return true;
}

/**
 * Recall the top-K lessons most relevant to a situation.
 * Tries Supabase first; falls back to local JSON store if Supabase is unavailable or returns nothing.
 * @param {string} deviceId
 * @param {string} situation
 * @param {string} ollamaUrl
 * @param {number} [topK]
 * @param {object} [supabase] — optional Supabase client
 * @returns {object[]} — array of lesson objects
 */
async function recall(deviceId, situation, ollamaUrl, topK = RECALL_TOP_K, supabase = null) {
    const situationEmbed = await embed(situation.slice(0, 256), ollamaUrl);
    if (!situationEmbed) return [];

    // Try Supabase first (using RPC function for vector search)
    if (supabase) {
        try {
            const { data, error } = await supabase.rpc('match_procedural_lessons', {
                query_device_id: deviceId,
                query_embedding: JSON.stringify(situationEmbed),
                match_threshold: MIN_SIM,
                max_results: topK
            });

            if (!error && data && data.length > 0) {
                return data.map(l => ({
                    id: l.id,
                    situation: l.situation,
                    lesson: l.lesson,
                    confidence: l.confidence,
                    application_count: l.application_count,
                    success_rate: l.success_rate,
                    similarity: l.similarity,
                    source: 'supabase'
                }));
            }
        } catch (e) {
            console.log('[ProceduralMemory] Supabase retrieval failed, falling back to local:', e.message);
        }
    }

    // Fall back to local JSON store
    const db = loadStore();
    const lessons = db[deviceId]?.lessons || [];
    if (lessons.length === 0) return [];

    const scored = lessons
        .filter(l => l.situation_emb)
        .map(l => ({
            ...l,
            sim: cosine(situationEmbed, l.situation_emb)
        }))
        .filter(l => l.sim >= MIN_SIM)
        .sort((a, b) => (b.confidence * b.sim) - (a.confidence * a.sim))
        .slice(0, topK)
        .map(l => ({
            id: l.id,
            situation: l.situation,
            lesson: l.lesson,
            confidence: l.confidence,
            application_count: l.application_count,
            success_count: l.success_count,
            success_rate: l.application_count > 0 ? l.success_count / l.application_count : 0,
            similarity: l.sim,
            source: 'local'
        }));

    return scored;
}

/**
 * Update lesson application stats after applying a lesson.
 * @param {string} lessonId
 * @param {boolean} wasSuccessful
 * @param {object} [supabase] — optional Supabase client
 */
async function updateApplication(lessonId, wasSuccessful, supabase = null) {
    // Update local JSON
    const db = loadStore();
    for (const deviceId in db) {
        const lesson = db[deviceId].lessons.find(l => l.id === lessonId);
        if (lesson) {
            lesson.application_count++;
            if (wasSuccessful) lesson.success_count++;
            lesson.confidence = Math.min(1.0, Math.max(0.1, 
                lesson.confidence + (wasSuccessful ? 0.05 : -0.1)
            ));
            lesson.last_applied_at = new Date().toISOString();
            lesson.updated_at = new Date().toISOString();
            saveStore(db);
            break;
        }
    }

    // Update Supabase (best-effort)
    if (supabase) {
        try {
            await supabase.rpc('update_lesson_application', {
                lesson_id: lessonId,
                was_successful: wasSuccessful
            });
        } catch (e) {
            console.log('[ProceduralMemory] Supabase update failed:', e.message);
        }
    }
}

/**
 * List all lessons for a device (for debugging / review).
 * When supabase is provided, reads from Supabase; also always reads local JSON.
 * Returns merged results (Supabase preferred when available).
 * @param {string} deviceId
 * @param {object} [supabase] — optional Supabase client
 */
async function listLessons(deviceId, supabase = null) {
    // Always include local JSON entries as baseline
    const db = loadStore();
    const localEntries = (db[deviceId]?.lessons || []).map(l => ({
        id: l.id,
        situation: l.situation,
        lesson: l.lesson,
        confidence: l.confidence,
        application_count: l.application_count,
        success_count: l.success_count,
        created_at: l.created_at,
        source: 'local'
    }));

    if (!supabase) return localEntries;

    try {
        const { data, error } = await supabase
            .from('heidi_procedural_lessons')
            .select('id, situation, lesson, confidence, application_count, success_count, created_at')
            .eq('device_id', deviceId)
            .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
            return data.map(row => ({
                id: row.id,
                situation: row.situation,
                lesson: row.lesson,
                confidence: row.confidence,
                application_count: row.application_count,
                success_count: row.success_count,
                created_at: row.created_at,
                source: 'supabase'
            }));
        }
    } catch (e) {
        console.log('[ProceduralMemory] Supabase list failed:', e.message);
    }

    return localEntries;
}

/**
 * Delete all lessons for a device.
 * When supabase is provided, deletes from both Supabase and local JSON.
 * @param {string} deviceId
 * @param {object} [supabase] — optional Supabase client
 */
async function clearLessons(deviceId, supabase = null) {
    // Always clear local JSON
    const db = loadStore();
    if (db[deviceId]) {
        delete db[deviceId];
        saveStore(db);
    }

    if (supabase) {
        try {
            await supabase
                .from('heidi_procedural_lessons')
                .delete()
                .eq('device_id', deviceId);
        } catch (e) {
            console.log('[ProceduralMemory] Supabase clear failed:', e.message);
        }
    }
}

/**
 * Prune low-confidence lessons.
 * @param {number} [minConfidence] — default 0.3
 * @param {number} [minAgeDays] — default 30
 * @param {object} [supabase] — optional Supabase client
 * @returns {number} — number of lessons pruned
 */
async function pruneLessons(minConfidence = 0.3, minAgeDays = 30, supabase = null) {
    let prunedCount = 0;
    const now = Date.now();
    const minAgeMs = minAgeDays * 86400000;

    // Prune local JSON
    const db = loadStore();
    for (const deviceId in db) {
        const beforeCount = db[deviceId].lessons.length;
        db[deviceId].lessons = db[deviceId].lessons.filter(l => {
            const age = now - new Date(l.created_at).getTime();
            return l.confidence >= minConfidence || age < minAgeMs;
        });
        prunedCount += beforeCount - db[deviceId].lessons.length;
    }
    saveStore(db);

    // Prune Supabase (best-effort)
    if (supabase) {
        try {
            const { data } = await supabase.rpc('prune_low_confidence_lessons', {
                min_confidence: minConfidence,
                min_age_days: minAgeDays
            });
            if (data) prunedCount += data;
        } catch (e) {
            console.log('[ProceduralMemory] Supabase prune failed:', e.message);
        }
    }

    return prunedCount;
}

module.exports = { 
    storeLesson, 
    recall, 
    updateApplication, 
    listLessons, 
    clearLessons, 
    pruneLessons 
};
