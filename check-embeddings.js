#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = 'http://127.0.0.1:11434';

const client = createClient(SUPABASE_URL, SUPABASE_KEY);

async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
  });
  let v = (await r.json()).embedding;
  if (v.length < 1536) v = v.concat(Array(1536 - v.length).fill(0));
  return v;
}

// Cosine similarity
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const norm = v => Math.sqrt(v.reduce((sum, x) => sum + x*x, 0));
const cosineSim = (a, b) => dot(a, b) / (norm(a) * norm(b));

(async () => {
  const question = 'How does AppForge work?';
  console.log(`Embedding question: "${question}"`);
  const qvec = await embed(question);
  console.log('✅ Got embedding (dim=' + qvec.length + ')\n');

  // Fetch all facts
  const { data: facts, error } = await client
    .from('hydi_facts')
    .select('division, content, confidence, embedding');

  if (error) {
    console.error('❌ Query error:', error);
    process.exit(1);
  }

  console.log('Raw facts fetched:', facts.length);
  if (facts.length > 0) {
    console.log('Sample fact 1:', {
      division: facts[0].division,
      content_len: facts[0].content.length,
      embedding_type: typeof facts[0].embedding,
      embedding_is_array: Array.isArray(facts[0].embedding),
      embedding_sample: Array.isArray(facts[0].embedding) ? facts[0].embedding.slice(0, 3) : 'N/A'
    });
  }
  console.log('');

  // Rank by cosine distance
  const ranked = facts
    .filter(f => f.embedding)
    .map(f => {
      let emb;
      if (Array.isArray(f.embedding)) {
        emb = f.embedding;
      } else if (typeof f.embedding === 'string') {
        // Parse pgvector string format: [0.123, 0.456, ...]
        emb = JSON.parse(f.embedding);
      } else {
        return null;
      }
      return {
        division: f.division,
        content: f.content,
        confidence: f.confidence,
        distance: 1 - cosineSim(qvec, emb)
      };
    })
    .filter(f => f !== null)
    .sort((a, b) => a.distance - b.distance);

  console.log('All 27 facts ranked by cosine distance (to "' + question + '"):');
  console.log('─'.repeat(95));
  console.log('Rank  Division     Distance   Conf   Content (first 60 chars)');
  console.log('─'.repeat(95));

  ranked.forEach((f, i) => {
    const rankStr = (i+1).toString().padEnd(5);
    const divStr = f.division.padEnd(12);
    const distStr = f.distance.toFixed(3).padEnd(10);
    const confStr = (Math.round(f.confidence * 100) + '%').padEnd(6);
    const contentStr = f.content.substring(0, 60).replace(/\n/g, ' ');
    console.log(rankStr + divStr + distStr + confStr + contentStr);
  });

  console.log('\n✅ Top 5 (what pgvector search should return):');
  console.log('─'.repeat(95));
  ranked.slice(0, 5).forEach((f, i) => {
    console.log(`${i+1}. [${f.division}] distance=${f.distance.toFixed(3)}`);
    console.log(`   "${f.content}"\n`);
  });
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
