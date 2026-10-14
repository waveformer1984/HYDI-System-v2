import './env.js';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Apply every migrations/*.sql not yet recorded in walkie.schema_migrations, in name order. */
export async function migrate(databaseUrl: string, log: (m: string) => void = () => {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('create schema if not exists walkie');
    await client.query('create table if not exists walkie.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    // Advisory lock so two processes starting at once do not race.
    await client.query("select pg_advisory_lock(hashtext('walkie.migrate'))");
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query('select name from walkie.schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into walkie.schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
        log(`applied ${f}`);
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('walkie.migrate'))").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  migrate(url, (m) => console.log(m)).then(
    () => console.log('walkie migrations up to date'),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
