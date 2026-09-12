'use strict';
/**
 * Formats a persisted set of opportunities into the
 * "PROTOFORGE DAILY BRIEF" text format. Reads only what was actually
 * stored -- this never invents a number that isn't in the data it's given.
 */

function formatOpportunityLine(o, index) {
  const evidenceLine = (o.evidence || [])
    .map((e) => e.source_url)
    .filter(Boolean)
    .slice(0, 2)
    .join(', ') || 'no source URL captured';
  return [
    `${index + 1}. [${o.title}]`,
    `   Why it matters: ${o.why_it_matters || o.whyItMatters || 'n/a'}`,
    `   Evidence: ${evidenceLine}`,
    `   Estimated value: ${o.estimated_value || o.estimatedValue || 'unknown'}`,
    `   Required action: ${o.required_action || o.requiredAction || 'n/a'}`,
    `   Confidence: ${Math.round(o.confidence)}%`,
  ].join('\n');
}

/**
 * @param {object[]} opportunities  rows from opportunity-store.listOpportunities
 * @param {object} [opts]
 * @param {number} [opts.topN=5]
 * @returns {string}
 */
function buildBriefing(opportunities, opts = {}) {
  const topN = opts.topN || 5;
  const high = opportunities.filter((o) => o.status === 'high_confidence');
  const review = opportunities.filter((o) => o.status === 'needs_review');
  const rejected = opportunities.filter((o) => o.status === 'rejected');

  const top = [...opportunities]
    .sort((a, b) => Number(b.confidence) - Number(a.confidence))
    .slice(0, topN);

  const recommended = top[0];
  const recommendedLine = recommended
    ? `→ ${recommended.required_action || recommended.requiredAction} (${recommended.title})`
    : '→ No opportunities cleared review this run.';

  const lines = [
    'PROTOFORGE DAILY BRIEF',
    '────────────────────────',
    '',
    `Opportunities found: ${opportunities.length}`,
    `High-confidence:      ${high.length}`,
    `Needs review:         ${review.length}`,
    `Rejected:             ${rejected.length}`,
    '',
    'TOP OPPORTUNITIES',
    '',
  ];

  if (top.length === 0) {
    lines.push('(none)');
  } else {
    top.forEach((o, i) => {
      lines.push(formatOpportunityLine(o, i));
      lines.push('');
    });
  }

  lines.push('RECOMMENDED NEXT ACTION');
  lines.push(recommendedLine);
  lines.push('');
  lines.push('Human approval required: YES');

  return lines.join('\n');
}

module.exports = { buildBriefing, formatOpportunityLine };
