'use strict';

/**
 * Governance gate test for migration 20260715120000_agent_control_commands.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260715120000_agent_control_commands.sql';

describe('Migration 20260715120000 – Agent Control Commands', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('creates the agent_control_commands table', () => {
    expect(sql).toMatch(/create table if not exists public\.agent_control_commands/i);
  });

  it('constrains command to the five lifecycle actions', () => {
    expect(sql).toMatch(
      /check \(command in \('start', 'stop', 'restart', 'scale_up', 'scale_down'\)\)/i,
    );
  });

  it('constrains status to the defined state machine and defaults to pending', () => {
    expect(sql).toMatch(
      /check \(status in \('pending', 'processing', 'completed', 'failed', 'rejected'\)\)/i,
    );
    expect(sql).toMatch(/status\s+text not null default 'pending'/i);
  });

  it('table and index creation use IF NOT EXISTS', () => {
    const createTableStatements = sql.match(/CREATE TABLE[^\n]*/gi) || [];
    expect(createTableStatements.length).toBe(1);
    createTableStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));

    const createIndexStatements = sql.match(/CREATE INDEX[^\n]*/gi) || [];
    expect(createIndexStatements.length).toBeGreaterThanOrEqual(2);
    createIndexStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));
  });

  it('drops the policy before recreating it (no IF NOT EXISTS for CREATE POLICY)', () => {
    expect(sql).toMatch(/^\s*drop policy if exists "agent_control_commands_service_all"/im);
  });

  it('enables row level security and restricts to service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.agent_control_commands ENABLE ROW LEVEL SECURITY/i);
    const policyMatches = sql.match(/^\s*create policy[\s\S]*?;/gim) || [];
    expect(policyMatches.length).toBe(1);
    expect(policyMatches[0]).toMatch(/to service_role/i);
  });

  it('introduces no CREATE TYPE / ENUM (uses CHECK constraints instead)', () => {
    expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
    expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
  });
});
