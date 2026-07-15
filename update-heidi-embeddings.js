const { Client } = require('pg');

const PG_URL = process.env.PG_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OLLAMA = 'http://127.0.0.1:11434';

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

(async () => {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  
  console.log('Fetching HEIDI facts without embeddings...');
  const { rows: facts } = await client.query(
    'SELECT id, content FROM hydi_facts WHERE division = $1 AND embedding IS NULL',
    ['heidi']
  );
  
  console.log(`Found ${facts.length} HEIDI facts without embeddings`);
  
  for (const fact of facts) {
    console.log(`Generating embedding for: ${fact.content.substring(0, 50)}...`);
    const embedding = await embed(fact.content);
    const embeddingStr = '[' + embedding.join(',') + ']';
    
    await client.query(
      'UPDATE hydi_facts SET embedding = $1::vector WHERE id = $2',
      [embeddingStr, fact.id]
    );
    console.log(`✅ Updated fact ${fact.id}`);
  }
  
  console.log('\n✅ All HEIDI facts now have embeddings');
  await client.end();
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
