'use strict';

const crypto = require('crypto');

/**
 * Proposal draft from verified capabilities only — no invented portfolio.
 */

function proposalVersion(proposal) {
  return crypto.createHash('sha256').update(JSON.stringify(proposal)).digest('hex').slice(0, 16);
}

function buildProposal(opportunity, lead) {
  const a = opportunity.assessment || {};
  const cap = a.recommendedService || 'Technical delivery';
  const hours = a.economics?.estimatedHours || 16;
  const net = a.economics?.netRevenueUsd;
  const gross = a.economics?.grossRevenueUsd;
  const body = [
    `## Understanding`,
    (lead.description || lead.title || '').split('\n').slice(0, 6).join('\n').trim(),
    '',
    `## Proposed approach`,
    `HYDI can deliver this as **${cap}** using our verified stack (Next.js, Supabase, tested automation pipeline).`,
    `Estimated effort: ~${hours} hours including verification and handoff.`,
    '',
    `## Deliverables`,
    '- Scoped implementation aligned to the listing',
    '- Automated tests for changed behavior',
    '- Short operator handoff note (no fabricated client references)',
    '',
    `## Pricing (estimate)`,
    gross != null ? `Budget alignment: up to $${gross} gross; target net after fees/infra ~$${net != null ? Math.round(net) : 'TBD'}.` : 'Budget TBD — confirm scope before quoting.',
    '',
    `## Assumptions / questions`,
    '- [CONFIRM: deadline and access to repos/systems]',
    '- [CONFIRM: payment terms and platform]',
    '',
    lead.draft ? `## Starter draft (from scout)\n\n${lead.draft}` : '',
  ].filter(Boolean).join('\n');

  const proposal = {
  title: `Proposal: ${lead.title}`,
    body,
    recommendedService: cap,
    estimatedHours: hours,
    grossRevenueUsd: gross,
    netRevenueUsd: net,
    generatedAt: new Date().toISOString(),
    fabricatedClaims: false,
  };
  proposal.version = proposalVersion(proposal);
  return proposal;
}

module.exports = { buildProposal, proposalVersion };