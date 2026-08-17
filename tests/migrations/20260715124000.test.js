'use strict';

/**
 * Governance gate test for migration 20260715124000_memory_intelligence_foundation.sql
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260715124000_memory_intelligence_foundation.sql';

describe('Migration 20260715124000 – Memory & Intelligence Foundation', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('extends the existing memories table rather than creating a new store', () => {
    expect(sql.toUpperCase()).not.toMatch(/CREATE TABLE IF NOT EXISTS PUBLIC\.MEMORIES\b/);
    expect(sql).toMatch(/alter table public\.memories add column if not exists tags/i);
    expect(sql).toMatch(/alter table public\.memories add column if not exists importance_score/i);
    expect(sql).toMatch(/alter table public\.memories add column if not exists expires_at/i);
    expect(sql).toMatch(/alter table public\.memories add column if not exists last_accessed_at/i);
  });

  it('bounds importance_score to 0-1', () => {
    expect(sql).toMatch(/check \(importance_score >= 0 and importance_score <= 1\)/i);
  });

  it('adds a gin index for tag search', () => {
    expect(sql).toMatch(/create index if not exists idx_memories_tags\s+on public\.memories using gin \(tags\)/i);
  });

  it('creates the memory_audit_log table with the defined action set', () => {
    expect(sql).toMatch(/create table if not exists public\.memory_audit_log/i);
    expect(sql).toMatch(/check \(action in \('search', 'store', 'tag', 'expire', 'delete'\)\)/i);
  });

  it('defines an idempotent expire_stale_memories() function that logs its own sweep', () => {
    expect(sql).toMatch(/create or replace function public\.expire_stale_memories\(\)/i);
    expect(sql).toMatch(/delete from public\.memories/i);
    expect(sql).toMatch(/insert into public\.memory_audit_log \(action, detail\)/i);
  });

  it('enables RLS on memory_audit_log restricted to service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.memory_audit_log ENABLE ROW LEVEL SECURITY/i);
    const policyMatches = sql.match(/^\s*create policy[\s\S]*?;/gim) || [];
    expect(policyMatches.length).toBe(1);
    expect(policyMatches[0]).toMatch(/to service_role/i);
  });
});
