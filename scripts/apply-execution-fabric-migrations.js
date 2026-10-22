'use strict';

/**
 * Apply the existing execution-fabric migrations to Frank's local Postgres.
 * Every migration is idempotent and runs in its own transaction. Connection
 * details are read from environment variables and are never printed.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = Object.freeze([
  '20261014230000_execution_fabric_tasks.sql',
  '20261015170000_execution_fabric_correlation_id.sql',
  '20261015180000_execution_fabric_tenant_binding.sql',
]);

function loadLocalEnv() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env.local'), override: false });
    require('dotenv').config({ path: path.join(ROOT, '.env'), override: false });
  } catch { /* optional */ }
}

function postgresConfig(env = process.env) {
  const connectionString =
    env.EXECUTION_FABRIC_DATABASE_URL ||
    env.DATABASE_URL ||
    env.BILLING_DATABASE_URL;
  if (connectionString) return { connectionString };
  return {
    host: env.PG_HOST || '127.0.0.1',
    port: Number(env.PG_PORT || 54322),
    database: env.PG_DATABASE || 'postgres',
    user: env.PG_USER || 'postgres',
    password: env.PG_PASSWORD || 'postgres',
  };
}

async function applyExecutionFabricMigrations({ pool, root = ROOT } = {}) {
  const ownPool = !pool;
  const db = pool || new Pool({ ...postgresConfig(), max: 1, connectionTimeoutMillis: 5_000 });
  const applied = [];
  try {
    for (const name of MIGRATIONS) {
      const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8');
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    const check = await db.query(
      `SELECT to_regclass('public.execution_fabric_tasks') IS NOT NULL AS tasks,
              to_regclass('public.execution_fabric_observations') IS NOT NULL AS observations`,
    );
    const ready = check.rows && check.rows[0];
    if (!ready || ready.tasks !== true || ready.observations !== true) {
      throw new Error('execution-fabric tables are not ready');
    }
    return { ok: true, applied };
  } finally {
    if (ownPool) await db.end();
  }
}

if (require.main === module) {
  loadLocalEnv();
  applyExecutionFabricMigrations()
    .then((result) => {
      process.stdout.write(`Execution-fabric migrations ready (${result.applied.join(', ')}).\n`);
    })
    .catch(() => {
      process.stderr.write('Execution-fabric migration failed; no connection details were printed.\n');
      process.exitCode = 1;
    });
}

module.exports = {
  MIGRATIONS,
  postgresConfig,
  applyExecutionFabricMigrations,
};
