/**
 * Apply the adaptive_operator_events migration via pg.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  const { Client } = require('pg');
  const c = new Client({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '54322', 10),
    database: 'postgres', user: 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  });

  try {
    await c.connect();
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase', 'migrations', '20260822150000_adaptive_operator_events.sql'),
      'utf8',
    );
    await c.query(sql);
    console.log('adaptive_operator_events migration applied');

    const r = await c.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'adaptive_operator_events'");
    console.log('RLS:', r.rows[0]?.relrowsecurity);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : 'unknown');
  } finally {
    await c.end();
  }
  process.exit(0);
}

main().catch(console.error);
