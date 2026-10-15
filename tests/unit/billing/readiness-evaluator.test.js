'use strict';

const { evaluateBillingReadiness } = require('../../../lib/billing/readiness-evaluator');

describe('billing readiness evaluator', () => {
  it('never claims merge_eligible without live integration PASS', () => {
    const readiness = evaluateBillingReadiness({
      checks: [
        { check_id: 'H.webhook_signature_and_duplicate', status: 'PASS' },
        { check_id: 'I.cross_tenant_authorization', status: 'PASS' },
        { check_id: 'I.identity_revocation', status: 'PASS' },
        { check_id: 'B.supabase_postgres', status: 'PASS' },
        { check_id: 'C.migration_schema', status: 'PASS' },
        { check_id: 'A.env_preflight', status: 'PASS' },
        { check_id: 'E.session_signup_signin', status: 'NEEDS_HUMAN' },
      ],
    });
    expect(readiness.merge_eligible).toBe(false);
    expect(readiness.live_integration).toBe('NEEDS_HUMAN');
    expect(readiness.code_level).toBe('PASS');
  });

  it('reports BLOCKED live integration when postgres blocked', () => {
    const readiness = evaluateBillingReadiness({
      checks: [{ check_id: 'B.supabase_postgres', status: 'BLOCKED' }],
    });
    expect(readiness.live_integration).toBe('BLOCKED');
    expect(readiness.database_migrations).not.toBe('PASS');
  });
});
