'use strict';

/**
 * Evidence-backed billing readiness — derived from check outputs only.
 */

/**
 * @param {{ checks?: object[], task?: object, env?: object, pg?: object, humanEvidence?: object }} input
 */
function evaluateBillingReadiness(input = {}) {
  const checks = input.checks || [];
  const byId = Object.fromEntries(checks.map((c) => [c.check_id, c]));

  const statusOf = (id) => byId[id]?.status || 'NOT_RUN';
  const anyFail = checks.some((c) => c.status === 'FAIL');
  const pgBlocked = statusOf('B.supabase_postgres') === 'BLOCKED' || statusOf('B.supabase_postgres') === 'FAIL';

  const unitHermeticPass =
    statusOf('H.webhook_signature_and_duplicate') === 'PASS'
    && statusOf('I.cross_tenant_authorization') === 'PASS'
    && statusOf('I.identity_revocation') === 'PASS';

  const codeReady = !anyFail && unitHermeticPass;
  const dbReady = statusOf('C.migration_schema') === 'PASS';
  const envReady = statusOf('A.env_preflight') === 'PASS';

  const liveStages = ['E.session_signup_signin', 'F.session_checkout', 'G.stripe_webhook_live'];
  const livePass = liveStages.every((id) => statusOf(id) === 'PASS');
  const liveNeedsHuman = liveStages.some((id) => statusOf(id) === 'NEEDS_HUMAN');
  let live_integration = 'NOT_RUN';
  if (livePass) live_integration = 'PASS';
  else if (pgBlocked || !envReady) live_integration = 'BLOCKED';
  else if (liveNeedsHuman) live_integration = 'NEEDS_HUMAN';

  const operator_actions = [];
  if (pgBlocked) operator_actions.push('Start local Supabase and apply billing migrations');
  if (!envReady) operator_actions.push('Configure test-mode Stripe and billing webhook secrets');
  if (live_integration === 'NEEDS_HUMAN') {
    operator_actions.push('Complete docs/billing/SANDBOX_RUN_OPERATOR.md (signup, checkout, webhook evidence)');
  }
  operator_actions.push('Human security review of PR #367 before merge');

  const merge_eligible =
    codeReady
    && dbReady
    && envReady
    && live_integration === 'PASS'
    && false; /* operator approval + security review gates — never auto true */

  return {
    code_level: codeReady ? 'PASS' : anyFail ? 'FAIL' : 'NOT_RUN',
    unit_tests: unitHermeticPass ? 'PASS' : checks.length ? 'PARTIAL' : 'NOT_RUN',
    database_migrations: dbReady ? 'PASS' : pgBlocked ? 'BLOCKED' : statusOf('C.migration_schema') === 'FAIL' ? 'FAIL' : 'NOT_RUN',
    live_integration,
    security_review: 'NEEDS_HUMAN',
    operator_approval: 'NEEDS_HUMAN',
    merge_eligible,
    operator_actions,
    disposition: merge_eligible ? 'ready_for_merge' : live_integration === 'PASS' ? 'pending_review' : 'blocked_or_incomplete',
  };
}

module.exports = { evaluateBillingReadiness };
