/**
 * Apply the human_intervention_requests migration directly via Supabase RPC.
 * Used when supabase db push fails due to older non-idempotent migrations.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  // Read the migration SQL
  const migrationPath = path.resolve(process.cwd(), 'supabase', 'migrations', '20260901120000_human_intervention_requests.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`Applying migration: ${migrationPath}`);
  console.log(`SQL length: ${sql.length} bytes`);

  // Execute via Supabase's built-in SQL endpoint
  // The Supabase JS client doesn't have a direct SQL execution method,
  // but we can use the REST API's /rest/v1/rpc endpoint or the pg API.
  // Let's use the Supabase SQL endpoint directly.
  const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (response.ok) {
    console.log('Migration applied successfully via RPC');
  } else {
    const text = await response.text();
    console.log(`RPC attempt: ${response.status} ${text.substring(0, 200)}`);

    // Try direct pg connection via the Supabase pooler URL
    // Or try executing the SQL in chunks via individual statements
    console.log('\nTrying alternative: execute SQL via Supabase SQL endpoint...');

    // Use the PostgREST endpoint to check if table exists
    const { data, error } = await supabase
      .from('human_intervention_requests')
      .select('*')
      .limit(1);

    if (error && error.message.includes('Could not find the table')) {
      console.log('Table still does not exist. Need to apply migration manually.');
      console.log('Please run: supabase db reset --local');
      console.log('Or apply the SQL via psql or the Supabase dashboard.');
    } else if (error) {
      console.log(`Table check error: ${error.message}`);
    } else {
      console.log('Table exists! Migration was already applied.');
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
