/**
 * LessonRetrieval — semantic recall of durable lessons into planning.
 *
 *   lesson/experience events + memories rows
 *     → local Ollama embedding (nomic-embed-text, existing lib/embeddings)
 *     → cosine similarity over stored vectors
 *     → relevance threshold
 *     → planner context
 *
 * Truth rules: retrieval_method is always recorded ('semantic' |
 * 'lexical_fallback' | 'unavailable'); a lexical match is never labeled
 * semantic; zero hits is a real answer, not an error to hide.
 */
import { Pool } from 'pg';
import { generateEmbedding } from '../embeddings';

export interface RetrievedLesson {
  id: string;
  lesson: string;
  similarity: number | null;
  method: 'semantic' | 'lexical_fallback';
  whySelected: string;
  directives: Array<{ avoidCapability?: string; addAfter?: string; insertCapability?: string; insertParams?: Record<string, unknown>; unlessPredicate?: string }>;
}

const SIMILARITY_THRESHOLD = 0.35; // zero-padded nomic embeddings; measured baseline

/**
 * Persist a lesson durably AND embed it into the semantic layer.
 * Deduped by lessonKey so repeated identical failures don't produce an
 * embedding storm. Embedding failure is recorded — never silently
 * downgraded into claimed semantic availability.
 */
export async function persistLesson(
  pool: Pool,
  lesson: {
    lesson: string; whyItMatters: string; evidence: string[]; scope: string;
    confidence: string; applicability: string;
    directives?: RetrievedLesson['directives'];
  },
): Promise<{ lessonEventId: string | null; memoryId: string | null; embedding: 'embedded' | 'deduplicated' | 'EMBEDDING_UNAVAILABLE' }> {
  const lessonKey = lesson.lesson.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  const evt = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('lesson', $1, now()) RETURNING id`,
    [JSON.stringify({ ...lesson, lessonKey })],
  ).catch(() => null);
  const lessonEventId = evt?.rows[0]?.id ?? null;

  // Dedupe: an identical lesson already embedded — don't re-embed.
  const existing = await pool.query(
    `SELECT id FROM memories WHERE kind='episodic' AND metadata->>'lessonKey'=$1 AND embedding IS NOT NULL LIMIT 1`,
    [lessonKey],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  if (existing.rows[0]) {
    return { lessonEventId, memoryId: existing.rows[0].id, embedding: 'deduplicated' };
  }

  let embedding: number[] | null = null;
  let embeddingError: string | null = null;
  try {
    const v = await generateEmbedding(`Lesson: ${lesson.lesson} — ${lesson.whyItMatters}`);
    embedding = Array.isArray(v) ? v : parseVector(v as unknown as string);
  } catch (e) {
    embeddingError = e instanceof Error ? e.message.slice(0, 100) : 'embed failed';
  }

  if (!embedding) {
    // Honest state: the lesson event persists; the memory row records
    // the embedding failure so retrieval knows this lesson is not
    // semantically reachable yet.
    const mem = await pool.query(
      `INSERT INTO memories (user_id, session_id, content, kind, metadata, created_at)
         VALUES ('heidi', 'lessons', $1, 'episodic', $2, now()) RETURNING id`,
      [lesson.lesson,
      JSON.stringify({ ...lesson, lessonKey, lessonEventId, embeddingStatus: 'EMBEDDING_UNAVAILABLE', embeddingError })],
    ).catch(() => null);
    return { lessonEventId, memoryId: mem?.rows[0]?.id ?? null, embedding: 'EMBEDDING_UNAVAILABLE' };
  }

  const mem = await pool.query(
    `INSERT INTO memories (user_id, session_id, content, embedding, kind, metadata, created_at)
       VALUES ('heidi', 'lessons', $1, $2::vector, 'episodic', $3, now()) RETURNING id`,
    [lesson.lesson, `[${embedding.join(',')}]`,
    JSON.stringify({ ...lesson, lessonKey, lessonEventId, embeddingStatus: 'embedded' })],
  ).catch(() => null);
  return { lessonEventId, memoryId: mem?.rows[0]?.id ?? null, embedding: 'embedded' };
}

interface LessonRow {
  id: string; content: string; created_at: string;
  metadata?: { lesson?: string; directives?: RetrievedLesson['directives'] };
  embedding?: string | number[] | null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function parseVector(v: string | number[] | null | undefined): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try { return (v as string).replace(/^\[|\]$/g, '').split(',').map(Number); } catch { return null; }
}

export interface RecallResult {
  method: 'semantic' | 'lexical_fallback' | 'unavailable';
  embeddingModel: string | null;
  queryEmbeddingFailed?: string;
  lessons: RetrievedLesson[];
  considered: number;
}

/** Semantic recall from the memories table (kind='episodic' + lessons in heidi_events). */
export async function recallLessons(pool: Pool, query: string): Promise<RecallResult> {
  let embedding: number[] | null = null;
  let embeddingError: string | undefined;
  try {
    const v = await generateEmbedding(query);
    embedding = Array.isArray(v) ? v : parseVector(v as unknown as string);
  } catch (e) {
    embeddingError = e instanceof Error ? e.message.slice(0, 100) : 'embed failed';
  }

  // Gather durable lessons: memories(kind=episodic) + lesson/plan_step_failed events
  const mems = await pool.query(
    `SELECT id, content, metadata, embedding::text AS emb, created_at FROM memories
       WHERE kind='episodic' ORDER BY created_at DESC LIMIT 200`,
  ).catch(() => ({ rows: [] as Array<{ id: string; content: string; metadata: Record<string, unknown>; emb: string; created_at: string }> }));
  const evts = await pool.query(
    `SELECT id, payload, created_at FROM heidi_events
       WHERE event_type IN ('lesson','plan_step_failed','replan') ORDER BY created_at DESC LIMIT 200`,
  ).catch(() => ({ rows: [] as Array<{ id: string; payload: Record<string, unknown>; created_at: string }> }));

  const candidates: LessonRow[] = [
    ...mems.rows.map(r => ({ id: `mem:${r.id}`, content: r.content, metadata: r.metadata as LessonRow['metadata'], created_at: r.created_at, embedding: parseVector(r.emb) })),
    ...evts.rows.map(r => ({
      id: `evt:${r.id}`,
      content: String(r.payload.lesson ?? r.payload.reason ?? JSON.stringify(r.payload)).slice(0, 400),
      metadata: r.payload as LessonRow['metadata'],
      created_at: r.created_at, embedding: null,
    })),
  ];

  if (!candidates.length) return { method: 'unavailable', embeddingModel: null, lessons: [], considered: 0, queryEmbeddingFailed: embeddingError };

  if (embedding && embedding.length) {
    const scored = candidates
      .filter(c => parseVector(c.embedding as string | number[] | null) !== null)
      .map(c => ({ c, sim: cosine(embedding, parseVector(c.embedding as string | number[] | null) as number[]) }));
    // Dedupe near-identical memories (repeated 'Experience:' rows for the
    // same goal crowd out unique lessons) — keep the best-scored one.
    const seen = new Set<string>();
    const deduped = scored.filter(s => {
      const key = String(s.c.content).slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    // Applicability boost: lessons carrying actionable planning
    // directives are policy-relevant — they earn a bounded lift, still
    // requiring the similarity floor.
    const DIRECTIVE_BOOST = 0.08;
    const hits = deduped.filter(s => s.sim >= SIMILARITY_THRESHOLD)
      .map(s => ({
        ...s,
        boost: (s.c.metadata?.directives as unknown[] | undefined)?.length ? DIRECTIVE_BOOST : 0,
      }))
      .sort((a, b) => (b.sim + b.boost) - (a.sim + a.boost)).slice(0, 6);
    return {
      method: 'semantic', embeddingModel: 'nomic-embed-text', considered: scored.length,
      lessons: hits.map(h => ({
        id: h.c.id,
        lesson: String(h.c.metadata?.lesson ?? h.c.content).slice(0, 200),
        similarity: Math.round(h.sim * 1000) / 1000,
        method: 'semantic' as const,
        whySelected: `cosine ${h.sim.toFixed(3)} ≥ ${SIMILARITY_THRESHOLD}${h.boost ? ' + directive boost' : ''}`,
        directives: (h.c.metadata?.directives as RetrievedLesson['directives']) ?? [],
      })),
    };
  }

  // Lexical fallback — explicitly labeled, never presented as semantic.
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 4).slice(0, 8);
  const hits = candidates
    .map(c => ({ c, hits: words.filter(w => c.content.toLowerCase().includes(w)).length }))
    .filter(h => h.hits >= 2)
    .sort((a, b) => b.hits - a.hits).slice(0, 4);
  return {
    method: 'lexical_fallback', embeddingModel: null, considered: candidates.length,
    queryEmbeddingFailed: embeddingError ?? 'no embedding produced',
    lessons: hits.map(h => ({
      id: h.c.id,
      lesson: String(h.c.metadata?.lesson ?? h.c.content).slice(0, 200),
      similarity: null,
      method: 'lexical_fallback' as const,
      whySelected: `lexical overlap ${h.hits}/${words.length} query terms`,
      directives: (h.c.metadata?.directives as RetrievedLesson['directives']) ?? [],
    })),
  };
}
