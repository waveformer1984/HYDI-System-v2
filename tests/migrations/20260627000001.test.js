'use strict';

/**
 * Governance gate test for migration 20260627000001_heidi_telemetry_foundation.sql
 *
 * Tests static SQL content only — no live Supabase connection required.
 * Satisfies the hdi-governance-gate.yml requirement: every new .sql migration
 * must have a corresponding test in tests/migrations/<version>.test.js
 */

const { readMigration } = require('./helpers');

const MIGRATION_FILE = '20260627000001_heidi_telemetry_foundation.sql';

describe('Migration 20260627000001 – HEIDI Telemetry Foundation Schema', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration(MIGRATION_FILE);
  });

  describe('baseline', () => {
    it('file is non-empty', () => {
      expect(sql.trim().length).toBeGreaterThan(0);
    });

    it('contains valid SQL keywords', () => {
      expect(sql.toUpperCase()).toMatch(/CREATE|ALTER|INSERT|UPDATE|DROP/);
    });

    it('contains all five expected table names', () => {
      expect(sql).toMatch(/heidi_telemetry/);
      expect(sql).toMatch(/heidi_metrics_snapshots/);
      expect(sql).toMatch(/heidi_performance_baseline/);
      expect(sql).toMatch(/heidi_module_performance/);
      expect(sql).toMatch(/heidi_drift_detection/);
    });
  });

  describe('table definitions use IF NOT EXISTS (idempotent)', () => {
    it('every CREATE TABLE is guarded', () => {
      const createTableStatements = sql.match(/CREATE TABLE[^\n]*/g) || [];
      expect(createTableStatements.length).toBe(5);
      createTableStatements.forEach((stmt) => {
        expect(stmt).toMatch(/IF NOT EXISTS/);
      });
    });
  });

  describe('indexes', () => {
    it('creates an index on created_at for every table (recency queries)', () => {
      expect(sql).toMatch(/idx_heidi_telemetry_created/);
      expect(sql).toMatch(/idx_heidi_metrics_snapshots_created/);
      expect(sql).toMatch(/idx_heidi_performance_baseline_created/);
      expect(sql).toMatch(/idx_heidi_module_performance_created/);
      expect(sql).toMatch(/idx_heidi_drift_detection_created/);
    });
  });

  describe('row level security', () => {
    it('enables RLS on every new table', () => {
      const tables = [
        'heidi_telemetry',
        'heidi_metrics_snapshots',
        'heidi_performance_baseline',
        'heidi_module_performance',
        'heidi_drift_detection',
      ];
      tables.forEach((table) => {
        expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
      });
    });

    it('grants service_role access via a CREATE POLICY for every table', () => {
      const policyMatches = sql.match(/CREATE POLICY[^\n]*/g) || [];
      expect(policyMatches.length).toBe(5);
      policyMatches.forEach((stmt) => {
        expect(stmt).toMatch(/ON public\.heidi_/);
      });
      expect(sql).toMatch(/auth\.role\(\) = 'service_role'/);
    });
  });

  describe('state machine', () => {
    it('introduces no enum or state-machine transitions requiring approval', () => {
      expect(sql.toUpperCase()).not.toMatch(/CREATE TYPE/);
      expect(sql.toUpperCase()).not.toMatch(/\bENUM\b/);
    });
  });
});
