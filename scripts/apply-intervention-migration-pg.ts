/**
 * Apply the human_intervention_requests migration directly via pg.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  const { Client } = require('pg');

  const host = process.env.PG_HOST || '127.0.0.1';
  const port = parseInt(process.env.PG_PORT || '54322', 10);
  const database = process.env.PG_DATABASE || 'postgres';
  const user = process.env.PG_USER || 'postgres';
  const password = process.env.PG_PASSWORD || 'postgres';

  console.log(`Connecting to PostgreSQL at ${host}:${port}/${database} as ${user}`);

  const client = new Client({ host, port, database, user, password });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    // Read the migration SQL
    const migrationPath = path.resolve(process.cwd(), 'supabase', 'migrations', '20260901120000_human_intervention_requests.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`Applying migration: ${path.basename(migrationPath)}`);
    console.log(`SQL length: ${sql.length} bytes`);

    await client.query(sql);
    console.log('Migration applied successfully!');

    // Verify the table exists
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'human_intervention_requests'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.log(`\nTable columns (${result.rows.length}):`);
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    }

    // Verify RLS
    const rlsResult = await client.query(`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'human_intervention_requests';
    `);
    console.log(`\nRLS enabled: ${rlsResult.rows[0]?.relrowsecurity ?? false}`);

    // Verify indexes
    const indexResult = await client.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'human_intervention_requests';
    `);
    console.log(`\nIndexes (${indexResult.rows.length}):`);
    for (const row of indexResult.rows) {
      console.log(`  ${row.indexname}`);
    }

    // Verify trigger
    const triggerResult = await client.query(`
      SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_table = 'human_intervention_requests';
    `);
    console.log(`\nTriggers (${triggerResult.rows.length}):`);
    for (const row of triggerResult.rows) {
      console.log(`  ${row.trigger_name}`);
    }

  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  } finally {
    await client.end();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
