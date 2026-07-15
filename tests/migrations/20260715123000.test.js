'use strict';

/**
 * Governance gate test for migration 20260715123000_notifications.sql
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260715123000_notifications.sql';

describe('Migration 20260715123000 – Notifications', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('creates the notifications table with the required categories', () => {
    expect(sql).toMatch(/create table if not exists public\.notifications/i);
    [
      'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
      'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
      'approval_required', 'destructive_action_confirmation',
    ].forEach((c) => expect(sql).toMatch(new RegExp(`'${c}'`)));
  });

  it('constrains severity to the four defined tiers', () => {
    expect(sql).toMatch(/check \(severity in \('critical', 'operational', 'approval', 'info'\)\)/i);
  });

  it('supports read/unread state via a nullable read_at column', () => {
    expect(sql).toMatch(/read_at\s+timestamptz/i);
  });

  it('creates notification_preferences keyed by device with a categories jsonb map', () => {
    expect(sql).toMatch(/create table if not exists public\.notification_preferences/i);
    expect(sql).toMatch(/device_id\s+text primary key/i);
    expect(sql).toMatch(/categories\s+jsonb not null default/i);
  });

  it('table creation uses IF NOT EXISTS', () => {
    const createTableStatements = sql.match(/CREATE TABLE[^\n]*/gi) || [];
    expect(createTableStatements.length).toBe(2);
    createTableStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));
  });

  it('enables RLS and restricts both tables to service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.notifications ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE public\.notification_preferences ENABLE ROW LEVEL SECURITY/i);
    const policyMatches = sql.match(/^\s*create policy[\s\S]*?;/gim) || [];
    expect(policyMatches.length).toBe(2);
    policyMatches.forEach((p) => expect(p).toMatch(/to service_role/i));
  });
});
