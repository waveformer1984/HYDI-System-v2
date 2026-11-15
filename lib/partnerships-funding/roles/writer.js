'use strict';

const { PIPELINE_STATES } = require('../constants');

const SECRET_PATTERN = /(sk-[a-z0-9_-]{10,}|Bearer\s+[a-z0-9._-]+)/gi;

function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SECRET_PATTERN, '[REDACTED]');
}

function buildApplicationDraft(opportunity, profile, eligibility) {
  const unresolved = [];
  if (eligibility.missing_facts?.length) {
    unresolved.push(...eligibility.missing_facts.map((m) => `Need owner input: ${m.requirement}`));
  }
  if (eligibility.eligibility_result === 'ineligible') {
    unresolved.push('Program appears ineligible with current facts — confirm before drafting for external use.');
  }

  const entity = profile?.legal?.entity_name || 'UNKNOWN';
  const product = profile?.product?.one_line_description || 'UNKNOWN';

  const sections = {
    executive_summary: redactSecrets(
      `${opportunity.program_name} (${opportunity.provider}): ${opportunity.benefit_summary || 'See official source'}. ` +
        `This draft is for owner review only. Not submitted.`,
    ),
    product_description: redactSecrets(String(product)),
    organization: redactSecrets(`Legal entity: ${entity} (owner-approved profile required before external send).`),
    requested_support: profile?.goals?.requested_support || 'UNKNOWN',
    how_api_would_be_used: profile?.product?.api_use_case || 'UNKNOWN — operator to complete',
    evidence_links: [opportunity.official_source_url],
    unresolved_questions: unresolved,
  };

  return {
    ok: true,
    draft: sections,
    pipeline_state: PIPELINE_STATES.DRAFTING,
    classification: 'AWAITING_OWNER_REVIEW',
    external_send: false,
  };
}

module.exports = { buildApplicationDraft, redactSecrets };