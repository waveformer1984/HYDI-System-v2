/**
 * Tests for 20260617000002_sprint3_qualify_functions_and_restrict_rls.sql
 *
 * Validates that:
 * - All 4 deferred SECURITY DEFINER functions receive a pinned search_path
 * - get_hydi_context and expire_stale_memories use qualified public.memory_entities
 * - All 6 blanket "Allow all operations" RLS policies are dropped
 * - infrastructure_health missing-role policy is dropped
 * - Replacement policies are scoped to service_role / authenticated
 */

const fs = require('fs');
const path = require('path');

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260617000002_sprint3_qualify_functions_and_restrict_rls.sql'
);

function readMigration() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

describe('Migration 20260617000002', () => {
  let sql;

  beforeAll(() => {
    sql = readMigration();
  });

  // ── Existence ────────────────────────────────────────────────────────────
  test('migration file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(100);
  });

  // ── Part 1: function search_path fixes ──────────────────────────────────
  describe('SECURITY DEFINER search_path pins', () => {
    test('alters keeper_auto_escalate', () => {
      expect(sql).toMatch(/alter function\s+public\.keeper_auto_escalate\s*\(\s*\)/i);
    });

    test('alters calibrate_protoforge_decisions', () => {
      expect(sql).toMatch(/alter function\s+public\.calibrate_protoforge_decisions\s*\(/i);
    });

    test('replaces get_hydi_context with CREATE OR REPLACE', () => {
      expect(sql).toMatch(/create or replace function\s+public\.get_hydi_context\s*\(/i);
    });

    test('replaces expire_stale_memories with CREATE OR REPLACE', () => {
      expect(sql).toMatch(/create or replace function\s+public\.expire_stale_memories\s*\(\s*\)/i);
    });

    test('all four functions receive set search_path with public, extensions, pg_catalog', () => {
      const matches = (sql.match(/set search_path\s*=\s*'public'\s*,\s*'extensions'\s*,\s*'pg_catalog'/gi) || []);
      // 2 ALTER FUNCTION statements + 2 CREATE OR REPLACE bodies = 4
      expect(matches.length).toBe(4);
    });
  });

  // ── Unqualified table name elimination ───────────────────────────────────
  describe('memory_entities qualification', () => {
    test('get_hydi_context body uses public.memory_entities (not bare memory_entities)', () => {
      // Extract the get_hydi_context function body
      const fnMatch = sql.match(
        /create or replace function\s+public\.get_hydi_context[\s\S]*?\$\$[\s\S]*?\$\$;/i
      );
      expect(fnMatch).not.toBeNull();
      const body = fnMatch[0];
      // All occurrences of memory_entities should be prefixed with public.
      const bareRefs = body.match(/(?<!public\.)memory_entities/g);
      expect(bareRefs).toBeNull();
    });

    test('expire_stale_memories body uses public.memory_entities (not bare memory_entities)', () => {
      const fnMatch = sql.match(
        /create or replace function\s+public\.expire_stale_memories[\s\S]*?\$\$[\s\S]*?\$\$;/i
      );
      expect(fnMatch).not.toBeNull();
      const body = fnMatch[0];
      const bareRefs = body.match(/(?<!public\.)memory_entities/g);
      expect(bareRefs).toBeNull();
    });
  });

  // ── Part 2: RLS policy drops ─────────────────────────────────────────────
  describe('DROP POLICY statements', () => {
    const droppedPolicies = [
      ['theme_predictions',         'Allow all operations on theme_predictions'],
      ['theme_outcomes',            'Allow all operations on theme_outcomes'],
      ['theme_accuracy',            'Allow all operations on theme_accuracy'],
      ['overconfidence_events',     'Allow all operations on overconfidence_events'],
      ['heidi_reflections',         'Allow all operations on heidi_reflections'],
      ['system_misalignment_events','Allow all operations on system_misalignment_events'],
      ['infrastructure_health',     'service_role_write'],
    ];

    droppedPolicies.forEach(([table, policyName]) => {
      test(`drops "${policyName}" on ${table}`, () => {
        const re = new RegExp(
          `drop policy if exists\\s+"${policyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+on\\s+public\\.${table}`,
          'i'
        );
        expect(sql).toMatch(re);
      });
    });
  });

  // ── Part 2: RLS policy replacements ──────────────────────────────────────
  describe('replacement RLS policies', () => {
    const heidiMemoryTables = [
      'theme_predictions',
      'theme_outcomes',
      'theme_accuracy',
      'overconfidence_events',
      'heidi_reflections',
      'system_misalignment_events',
    ];

    heidiMemoryTables.forEach((tbl) => {
      test(`rebuilds service_role_all policy for ${tbl}`, () => {
        expect(sql).toMatch(
          new RegExp(`create policy\\s+${tbl}_service_role_all`, 'i')
        );
      });

      test(`rebuilds authenticated_read policy for ${tbl}`, () => {
        expect(sql).toMatch(
          new RegExp(`create policy\\s+${tbl}_authenticated_read`, 'i')
        );
      });
    });

    test('new policies use TO service_role', () => {
      expect(sql).toMatch(/to service_role/i);
    });

    test('new policies use TO authenticated for reads', () => {
      expect(sql).toMatch(/to authenticated/i);
    });

    test('infrastructure_health gets explicit service_role policy', () => {
      expect(sql).toMatch(/create policy infrastructure_health_service_role_write/i);
      expect(sql).toMatch(
        /create policy infrastructure_health_service_role_write[\s\S]*?to service_role/i
      );
    });
  });

  // ── Sanity: no bare unqualified table refs in altered function statements ─
  describe('no regression on other tables', () => {
    test('does not alter keeper_auto_escalate body (only ALTER FUNCTION)', () => {
      // keeper_auto_escalate should appear in an ALTER FUNCTION line, not CREATE OR REPLACE
      expect(sql).not.toMatch(/create or replace function\s+public\.keeper_auto_escalate/i);
    });

    test('does not alter calibrate_protoforge_decisions body (only ALTER FUNCTION)', () => {
      expect(sql).not.toMatch(
        /create or replace function\s+public\.calibrate_protoforge_decisions/i
      );
    });
  });
});
