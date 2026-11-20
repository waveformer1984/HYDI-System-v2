#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ version: string }[]>`SELECT version FROM schema_migrations`).map((r) => r.version),
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }
    const body = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`apply ${file}`);
    await sql.unsafe(body);
    await sql`INSERT INTO schema_migrations (version) VALUES (${file})`;
  }

  await sql.end();
  console.log('migrations complete');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});