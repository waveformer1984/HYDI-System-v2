const { Client } = require('pg');

const PG_URL = process.env.PG_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  
  console.log('Checking HEIDI facts in database...');
  const result = await client.query('SELECT content, division FROM hydi_facts WHERE division = $1', ['heidi']);
  
  console.log(`Found ${result.rows.length} HEIDI facts:`);
  result.rows.forEach((row, i) => {
    console.log(`${i+1}. [${row.division}] ${row.content}`);
  });
  
  await client.end();
})().catch(console.error);
