const { Client } = require('pg');
const PG_URL = process.env.PG_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CHAT_MODEL = process.env.CHAT_MODEL || 'llama3.2';
const TOPK = 5;
const question = process.argv.slice(2).join(' ') || 'What do you know about AppForge?';

async function embed(text, dim = 1536) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:'nomic-embed-text', prompt:text }) });
  let v = (await r.json()).embedding;
  if (v.length < dim) v = v.concat(Array(dim - v.length).fill(0)); else if (v.length > dim) v = v.slice(0, dim);
  return '[' + v.join(',') + ']';
}
async function chat(prompt) {
  const r = await fetch(`${OLLAMA}/api/generate`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:CHAT_MODEL, prompt, stream:false }) });
  return (await r.json()).response;
}
(async () => {
  const db = new Client({ connectionString: PG_URL });
  await db.connect();
  console.log(`\n=== QUESTION ===\n${question}`);
  console.log(`\n[1] Embedding question -> nomic-embed-text`);
  const qvec = await embed(question);
  console.log(`[2] Searching procedural memory (pgvector cosine)...`);
  const facts = (await db.query(`select division, content, confidence, (embedding <=> $1::vector) as distance from hydi_facts where embedding is not null order by embedding <=> $1::vector limit ${TOPK}`, [qvec])).rows;
  console.log(`\n=== FACTS HEIDI RETRIEVED ===`);
  facts.forEach((f,i)=>console.log(`  ${i+1}. [${f.division}] d=${Number(f.distance).toFixed(3)} :: ${f.content}`));
  const context = facts.map(f=>`- (${f.division}) ${f.content}`).join('\n');
  const prompt = `You are Heidi. Answer the question using ONLY these facts from your memory. If they don't cover it, say so plainly.\n\nFACTS:\n${context}\n\nQUESTION: ${question}\n\nANSWER:`;
  console.log(`\n[3] llama3.2 answering from those facts...\n`);
  console.log(`=== GROUNDED ANSWER ===\n` + (await chat(prompt)).trim());
  await db.end();
})().catch(e=>{ console.error('FAILED:', e.message); process.exit(1); });
