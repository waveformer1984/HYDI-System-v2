'use strict';

/**
 * After operator records an award, describe integration steps — no auto-apply.
 */
const INTEGRATION_HINTS = Object.freeze({
  credits: {
    provider_examples: ['OpenAI', 'Anthropic'],
    operator_steps: [
      'Add credits to provider billing org; keep HYDI_ALLOW_PAID_LLM=false until intentional',
      'Record credit expiry and usage caps in portfolio monitor',
      'Route inference through lib/providers/openai-adapter.js or existing ModelManager gates',
    ],
    env_keys_touched: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'HYDI_ALLOW_PAID_LLM'],
    classification: 'REQUIRES_OPERATOR_APPROVAL',
  },
  platform_credits: {
    provider_examples: ['GitHub'],
    operator_steps: [
      'Redeem in GitHub Enterprise / billing dashboard — platform credits are not cash',
      'Map to CI minutes or Enterprise features; document in HYDI_ZERO_COST doc',
    ],
    env_keys_touched: [],
    classification: 'REQUIRES_OPERATOR_APPROVAL',
  },
  cash_grant: {
    operator_steps: ['Treasury / accounting — separate from API credits'],
    classification: 'REQUIRES_OPERATOR_APPROVAL',
  },
});

function integrationPlan(opportunity) {
  const cat = opportunity.benefit_category || 'credits';
  const hint = INTEGRATION_HINTS[cat] || INTEGRATION_HINTS.credits;
  return {
    ok: true,
    opportunity_id: opportunity.id,
    program_name: opportunity.program_name,
    benefit_category: cat,
    automatic_integration: false,
    execution_authority: 'operator_manual',
    hint,
    fabric_note: 'Optional verification: health.check via ExecutionGateway after credentials configured',
    classification: 'CONFIGURED_BUT_UNTESTED',
  };
}

module.exports = { INTEGRATION_HINTS, integrationPlan };