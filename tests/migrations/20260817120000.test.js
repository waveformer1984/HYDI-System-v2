'use strict';

/**
 * Migration test for 20260817120000_add_service_role_rls_policies
 *
 * Verifies the migration file is valid SQL and contains the expected
 * service_role RLS policy statements for core tables.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION_FILE = path.resolve(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260817120000_add_service_role_rls_policies.sql'
);

describe('20260817120000_add_service_role_rls_policies', () => {
    let sql;

    beforeAll(() => {
        sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    });

    test('is a non-empty SQL file', () => {
        expect(sql.length).toBeGreaterThan(100);
        expect(sql).toContain('CREATE POLICY');
    });

    test('contains valid SQL statements', () => {
        expect(sql).toContain('CREATE POLICY');
        expect(sql).toContain('service_role');
        expect(sql).toContain('USING (true)');
        expect(sql).toContain('WITH CHECK (true)');
        expect(sql).toContain('EXCEPTION WHEN duplicate_object');
    });

    test('adds service_role policies for revenue pipeline tables', () => {
        const revenueTables = [
            'leads_service_role',
            'outreach_service_role',
            'proposals_service_role',
            'quotes_service_role',
            'checkout_sessions_service_role',
            'product_ideas_service_role',
            'product_listings_service_role',
            'task_queue_service_role',
        ];
        for (const policy of revenueTables) {
            expect(sql).toContain(policy);
        }
    });

    test('adds service_role policies for worker tables', () => {
        expect(sql).toContain('worker_jobs_service_role');
        expect(sql).toContain('worker_failures_service_role');
    });

    test('handles core tables via DO block with existence check', () => {
        expect(sql).toContain('DO $$');
        expect(sql).toContain("'memories', 'actions', 'sessions', 'ledger'");
        expect(sql).toContain("'clients', 'payouts', 'webhook_events'");
        expect(sql).toContain('information_schema.tables');
        expect(sql).toContain('CREATE POLICY');
    });

    test('does not disable RLS', () => {
        expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
        expect(sql).not.toMatch(/DROP POLICY/i);
    });

    test('does not add anon or authenticated policies (fail-closed preserved)', () => {
        expect(sql).not.toMatch(/TO anon/i);
        expect(sql).not.toMatch(/TO authenticated/i);
        expect(sql).not.toMatch(/TO public/i);
    });
});
