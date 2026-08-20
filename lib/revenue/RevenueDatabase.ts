/**
 * HYDI Revenue Database Client
 *
 * A thin wrapper around the `pg` library for direct PostgreSQL access.
 * This bypasses PostgREST/Supabase REST API to avoid schema cache issues
 * with locally-created tables.
 *
 * Provides:
 *   - Connection pooling
 *   - Typed query helpers
 *   - Idempotent insert/upsert
 *   - JSONB handling
 *
 * Configuration:
 *   PG_HOST (default: 127.0.0.1)
 *   PG_PORT (default: 54322)
 *   PG_DATABASE (default: postgres)
 *   PG_USER (default: postgres)
 *   PG_PASSWORD (default: postgres)
 */

import { Pool, PoolClient, QueryResult } from 'pg';

export interface DBConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

export class RevenueDatabase {
  private pool: Pool;

  constructor(config?: DBConfig) {
    this.pool = new Pool({
      host: config?.host || process.env.PG_HOST || '127.0.0.1',
      port: config?.port || parseInt(process.env.PG_PORT || '54322', 10),
      database: config?.database || process.env.PG_DATABASE || 'postgres',
      user: config?.user || process.env.PG_USER || 'postgres',
      password: config?.password || process.env.PG_PASSWORD || 'postgres',
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  /**
   * Execute a query and return rows.
   */
  async query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  /**
   * Execute a query and return the first row, or null.
   */
  async queryOne<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute a query that returns a count.
   */
  async count(text: string, params?: unknown[]): Promise<number> {
    const rows = await this.query<{ count: number }>(text, params);
    return rows.length > 0 ? parseInt(String(rows[0].count), 10) : 0;
  }

  /**
   * Insert a row and return it.
   */
  async insert<T = Record<string, unknown>>(
    table: string,
    data: object,
  ): Promise<T> {
    const d = data as Record<string, unknown>;
    const columns = Object.keys(d);
    const values = Object.values(d);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const text = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const row = await this.queryOne<T>(text, values);
    if (!row) throw new Error(`Insert into ${table} returned no row`);
    return row;
  }

  /**
   * Update rows and return the first updated row.
   * The WHERE clause should use $N placeholders where N starts after the SET values.
   * For example, if SET has 3 values, WHERE should use $4, $5, etc.
   * Alternatively, use the offsetWhere helper to shift placeholders.
   */
  async update<T = Record<string, unknown>>(
    table: string,
    set: object,
    where: string,
    whereParams: unknown[] = [],
  ): Promise<T | null> {
    const s = set as Record<string, unknown>;
    const setKeys = Object.keys(s);
    const setValues = Object.values(s);
    const setClauses = setKeys.map((key, i) => `${key} = $${i + 1}`);
    // Shift WHERE clause placeholders by setValues.length
    const offset = setValues.length;
    const shiftedWhere = where.replace(/\$(\d+)/g, (_, num) => `$${parseInt(num, 10) + offset}`);
    const text = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${shiftedWhere} RETURNING *`;
    const row = await this.queryOne<T>(text, [...setValues, ...whereParams]);
    return row;
  }

  /**
   * Upsert (insert or update on conflict).
   */
  async upsert<T = Record<string, unknown>>(
    table: string,
    data: object,
    conflictColumns: string[],
  ): Promise<T> {
    const d = data as Record<string, unknown>;
    const columns = Object.keys(d);
    const values = Object.values(d);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');
    const text = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
      ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updateSet} RETURNING *`;
    const row = await this.queryOne<T>(text, values);
    if (!row) throw new Error(`Upsert into ${table} returned no row`);
    return row;
  }

  /**
   * Check if a row exists.
   */
  async exists(table: string, where: string, params: unknown[] = []): Promise<boolean> {
    const text = `SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`;
    const rows = await this.query(text, params);
    return rows.length > 0;
  }

  /**
   * Close the connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton instance
let dbInstance: RevenueDatabase | null = null;

export function getRevenueDatabase(config?: DBConfig): RevenueDatabase {
  if (!dbInstance) {
    dbInstance = new RevenueDatabase(config);
  }
  return dbInstance;
}
