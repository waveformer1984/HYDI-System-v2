'use strict';

/**
 * Governance gate test for migration 20260715121000_device_registration_rbac.sql
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260715121000_device_registration_rbac.sql';

describe('Migration 20260715121000 – Device Registration & Auth Audit Log', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  it('file is non-empty', () => {
    expect(sql.trim().length).toBeGreaterThan(0);
  });

  it('creates the devices table with the four RBAC roles', () => {
    expect(sql).toMatch(/create table if not exists public\.devices/i);
    expect(sql).toMatch(/check \(role in \('owner', 'operator', 'agent', 'viewer'\)\)/i);
    expect(sql).toMatch(/role\s+text not null default 'viewer'/i);
  });

  it('constrains device status to pending/approved/revoked', () => {
    expect(sql).toMatch(/check \(status in \('pending', 'approved', 'revoked'\)\)/i);
  });

  it('requires a unique device_id and stores only a secret hash, never a raw secret', () => {
    expect(sql).toMatch(/device_id\s+text not null unique/i);
    expect(sql).toMatch(/secret_hash\s+text not null/i);
    expect(sql).not.toMatch(/\bsecret\s+text/i);
  });

  it('creates the auth_audit_log table with the defined event types', () => {
    expect(sql).toMatch(/create table if not exists public\.auth_audit_log/i);
    expect(sql).toMatch(/'auth_success', 'auth_failure', 'device_registered'/i);
    expect(sql).toMatch(/'rate_limited'/i);
  });

  it('table and index creation use IF NOT EXISTS', () => {
    const createTableStatements = sql.match(/CREATE TABLE[^\n]*/gi) || [];
    expect(createTableStatements.length).toBe(2);
    createTableStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));

    const createIndexStatements = sql.match(/CREATE INDEX[^\n]*/gi) || [];
    createIndexStatements.forEach((stmt) => expect(stmt).toMatch(/IF NOT EXISTS/i));
  });

  it('enables RLS and restricts both tables to service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.devices ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE public\.auth_audit_log ENABLE ROW LEVEL SECURITY/i);

    const policyMatches = sql.match(/^\s*create policy[\s\S]*?;/gim) || [];
    expect(policyMatches.length).toBe(2);
    policyMatches.forEach((p) => expect(p).toMatch(/to service_role/i));
  });

  it('drops policies before recreating them', () => {
    expect(sql).toMatch(/^\s*drop policy if exists "devices_service_all"/im);
    expect(sql).toMatch(/^\s*drop policy if exists "auth_audit_log_service_all"/im);
  });
});
