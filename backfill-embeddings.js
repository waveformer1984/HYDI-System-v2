const { Client } = require('pg');
const PG_URL   = process.env.PG_URL    || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OLLAMA   = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL    = process.env.EMBED_MODEL || 'nomic-embed-text';
let   TEXT_COL = process.env.TEXT_COL  || null;

async function embed(text, dim) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text || '' }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  let v = (await r.json()).embedding;
  if (!Array.isArray(v)) throw new Error('No embedding returned from Ollama');
  if (v.length < dim) v = v.concat(Array(dim - v.length).fill(0));
  else if (v.length > dim) v = v.slice(0, dim);
  return '[' + v.join(',') + ']';
}

(async () => {
  const db = new Client({ connectionString: PG_URL });
  await db.connect();
  const dimRow = (await db.query(`select format_type(atttypid, atttypmod) as t from pg_attribute where attrelid = 'hydi_facts'::regclass and attname = 'embedding'`)).rows[0];
  const dm = dimRow && dimRow.t.match(/vector\((\d+)\)/);
  const dim = dm ? parseInt(dm[1], 10) : 1536;
  console.log(`embedding column = ${dimRow ? dimRow.t : 'unknown'} -> padding to ${dim}`);
  if (!TEXT_COL) {
    const cols = (await db.query(`select column_name, data_type from information_schema.columns where table_name = 'hydi_facts'`)).rows;
    const prefer = ['content','fact','text','description','body','statement','fact_text'];
    TEXT_COL = prefer.find(c => cols.some(r => r.column_name === c)) || cols.find(r => /text|character/.test(r.data_type))?.column_name;
    if (!TEXT_COL) throw new Error('No text column on hydi_facts - set TEXT_COL.');
  }
  console.log(`text column = ${TEXT_COL}`);
  const rows = (await db.query(`select id, ${TEXT_COL} as txt from hydi_facts where embedding is null`)).rows;
  console.log(`facts needing embeddings: ${rows.length}`);
  let n = 0;
  for (const row of rows) {
    const lit = await embed(row.txt, dim);
    await db.query(`update hydi_facts set embedding = $1::vector where id = $2`, [lit, row.id]);
    if (++n % 5 === 0 || n === rows.length) console.log(`  embedded ${n}/${rows.length}`);
  }
  const left = (await db.query(`select count(*)::int c from hydi_facts where embedding is null`)).rows[0].c;
  console.log(`done. embedded ${n}. remaining: ${left}`);
  await db.end();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
