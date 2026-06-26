#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
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

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const norm = v => Math.sqrt(v.reduce((sum, x) => sum + x*x, 0));
const cosineSim = (a, b) => dot(a, b) / (norm(a) * norm(b));

(async () => {
  console.log('\n🔍 Testing Semantic Search');
  console.log('═'.repeat(80));

  const query = 'What are Heidi decision bounds?';
  console.log(`Query: "${query}\n`);

  // Embed the query
  console.log('Embedding query...');
  const qvec = await embed(query);
  console.log('✅ Query embedded (1536-dim)\n');

  // Fetch all facts
  const { data: facts } = await client
    .from('hydi_facts')
    .select('division, content, confidence, embedding');

  console.log(`Fetched ${facts.length} facts\n`);

  // Rank by similarity
  const ranked = facts
    .map(f => {
      let emb;
      if (Array.isArray(f.embedding)) {
        emb = f.embedding;
      } else if (typeof f.embedding === 'string') {
        emb = JSON.parse(f.embedding);
      } else {
        return null;
      }
      return {
        division: f.division,
        content: f.content,
        confidence: f.confidence,
        similarity: cosineSim(qvec, emb)
      };
    })
    .filter(f => f !== null)
    .sort((a, b) => b.similarity - a.similarity);

  console.log('TOP 5 MATCHES (by cosine similarity):');
  console.log('─'.repeat(80));
  ranked.slice(0, 5).forEach((f, i) => {
    console.log(`\n${i+1}. [${f.division}] Similarity: ${f.similarity.toFixed(3)}`);
    console.log(`   ${f.content.substring(0, 100)}...`);
  });

  // Check if decision bounds are in top 5
  const topDivisions = ranked.slice(0, 5).map(f => f.division);
  const hasHEIDI = topDivisions.includes('heidi');

  console.log('\n' + '═'.repeat(80));
  if (hasHEIDI) {
    console.log('✅ HEIDI division in top 5 (decision bounds should be retrieved)\n');
  } else {
    console.log('⚠️  HEIDI division NOT in top 5 (semantic search may need tuning)\n');
    console.log('Facts matching "decision" or "bounds":');
    ranked.forEach((f, i) => {
      if (f.content.toLowerCase().includes('decision') ||
          f.content.toLowerCase().includes('bounds') ||
          f.content.toLowerCase().includes('0.85') ||
          f.content.toLowerCase().includes('$10')) {
        console.log(`  ${f.division}: similarity=${f.similarity.toFixed(3)}`);
      }
    });
  }
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
